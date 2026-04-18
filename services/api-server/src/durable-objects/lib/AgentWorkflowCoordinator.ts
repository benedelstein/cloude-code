import {
  type AgentOutput,
  type ClientState,
  type Logger,
  type ServerMessage,
  type SessionStatus,
  AgentSettings,
  encodeAgentInput,
  failure,
  success,
  type Result,
} from "@repo/shared";
import { SpritesError, WorkersSpriteClient } from "@/lib/sprites";
import type { Env } from "@/types";
import type { UIMessageChunk } from "ai";
import { MessageAccumulator } from "@repo/shared";
import { createLogger } from "@/lib/logger";
import { applyDerivedStateFromParts } from "../session-agent-derived-state";
import type { MessageRepository } from "../repositories/message-repository";
import type { PendingChunkRepository } from "../repositories/pending-chunk-repository";
import type { LatestPlanRepository } from "../repositories/latest-plan-repository";
import type { ServerState } from "../repositories/server-state-repository";
import type {
  AgentProcessRunnerTurnResult,
  PreparedWorkflowTurn,
} from "@/workflows/AgentProcessRunner";
import {
  workflowTurnFailure,
  type PrepareWorkflowTurnOverrides,
  type SessionTurnWorkflowParams,
  type WorkflowTurnFailure,
  type WorkflowTurnPayload,
} from "@/workflows/types";

const SESSION_TURN_WORKFLOW_BINDING = "SESSION_TURN_WORKFLOW";
const WORKFLOW_MESSAGE_AVAILABLE_EVENT = "message_available";

/**
 * Dependencies injected from the SessionAgentDO into the coordinator.
 * Keeps coupling explicit and avoids a circular type reference to the DO class.
 */
export interface WorkflowTurnCoordinatorDeps {
  logger: Logger;
  env: Env;

  // Repositories
  messageRepository: MessageRepository;
  pendingChunkRepository: PendingChunkRepository;
  latestPlanRepository: LatestPlanRepository;

  // DO state accessors (bound closures over `this` on the DO)
  /* eslint-disable no-unused-vars */
  getServerState: () => ServerState;
  updateWorkflowState: (partial: Partial<ServerState["workflowState"]>) => void;
  updateAgentSessionId: (agentSessionId: string) => void;
  getClientState: () => ClientState;
  updatePartialState: (partial: Partial<ClientState>) => void;
  broadcastMessage: (message: ServerMessage) => void;
  synthesizeStatus: () => SessionStatus;
  /* eslint-enable no-unused-vars */

  // Agents SDK workflow primitives (bound to the DO)
  /* eslint-disable no-unused-vars */
  getWorkflowStatus: (
    workflowName: string,
    workflowId: string,
  ) => Promise<InstanceStatus>;
  runWorkflow: <P>(
    workflowName: string,
    params: P,
    options?: {
      id?: string;
      metadata?: Record<string, unknown>;
      agentBinding?: string;
    },
  ) => Promise<string>;
  getWorkflow: (
    workflowId: string,
  ) => { workflowId: string } | undefined;
  sendWorkflowEvent: (
    workflowName: string,
    workflowId: string,
    event: { type: string; payload: unknown },
  ) => Promise<void>;
  /* eslint-enable no-unused-vars */
}

/**
 * Owns workflow-turn orchestration for a session: preparing turns, accepting
 * RPC callbacks from SessionTurnWorkflow, dispatching/cancelling turns,
 * accumulating streamed chunks, and reconciling state on DO restart.
 *
 * The SessionAgentDO owns this instance and delegates its public workflow RPC
 * methods into it. The coordinator never talks to the DO class directly —
 * all interaction is through the injected deps.
 */
export class AgentWorkflowCoordinator {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly messageRepository: MessageRepository;
  private readonly pendingChunkRepository: PendingChunkRepository;
  private readonly latestPlanRepository: LatestPlanRepository;
  private readonly getServerState: () => ServerState;
  private readonly updateWorkflowState: WorkflowTurnCoordinatorDeps["updateWorkflowState"];
  private readonly updateAgentSessionId: WorkflowTurnCoordinatorDeps["updateAgentSessionId"];
  private readonly getClientState: () => ClientState;
  private readonly updatePartialState: (partial: Partial<ClientState>) => void;
  private readonly broadcastMessage: (message: ServerMessage) => void;
  private readonly synthesizeStatus: () => SessionStatus;
  private readonly getWorkflowStatus: WorkflowTurnCoordinatorDeps["getWorkflowStatus"];
  private readonly runWorkflow: WorkflowTurnCoordinatorDeps["runWorkflow"];
  private readonly getWorkflow: WorkflowTurnCoordinatorDeps["getWorkflow"];
  private readonly sendWorkflowEvent: WorkflowTurnCoordinatorDeps["sendWorkflowEvent"];
  private hasEnsuredRehydratedState: boolean = false;

  private messageAccumulator = new MessageAccumulator(createLogger("MessageAccumulator"));
  /** Serializes workflow create/send operations for this session. */
  private workflowDispatchPromise: Promise<void> = Promise.resolve();

  constructor(deps: WorkflowTurnCoordinatorDeps) {
    this.logger = deps.logger.scope("workflow-turn-coordinator");
    this.env = deps.env;
    this.messageRepository = deps.messageRepository;
    this.pendingChunkRepository = deps.pendingChunkRepository;
    this.latestPlanRepository = deps.latestPlanRepository;
    this.getServerState = deps.getServerState;
    this.updateWorkflowState = deps.updateWorkflowState;
    this.updateAgentSessionId = deps.updateAgentSessionId;
    this.getClientState = deps.getClientState;
    this.updatePartialState = deps.updatePartialState;
    this.broadcastMessage = deps.broadcastMessage;
    this.synthesizeStatus = deps.synthesizeStatus;
    this.getWorkflowStatus = deps.getWorkflowStatus;
    this.runWorkflow = deps.runWorkflow;
    this.getWorkflow = deps.getWorkflow;
    this.sendWorkflowEvent = deps.sendWorkflowEvent;
  }

  /**
   * Rehydrates transient stream state from durable storage at most once per DO
   * instance before any RPC or websocket path relies on that state.
   */
  ensureRehydratedState(): void {
    if (this.hasEnsuredRehydratedState) return;
    const serverState = this.getServerState();
    const sessionId = serverState.sessionId;
    if (!sessionId) return;

    const orphanedChunks = this.pendingChunkRepository.getAll();
    if (orphanedChunks.length > 0) {
      this.logger.info("Rehydrating message accumulator from WAL on DO restart", {
        fields: {
          chunkCount: orphanedChunks.length,
          activeUserMessageId: serverState.workflowState.activeUserMessageId,
        },
      });

      for (const chunk of orphanedChunks) {
        const { completedParts } = this.messageAccumulator.process(chunk);
        applyDerivedStateFromParts(
          {
            sessionId,
            latestPlanRepository: this.latestPlanRepository,
            updatePartialState: (partial) => this.updatePartialState(partial),
          },
          completedParts,
          this.messageAccumulator.getMessageId(),
        );
      }
    }

    this.hasEnsuredRehydratedState = true;

    // If a workflow turn is durably marked active, schedule an async reconcile
    // that will clean up if the workflow is actually terminal.
    if (serverState.workflowState.activeUserMessageId) {
      this.logger.info("Reconciling active workflow turn on DO restart");
      this.reconcileActiveTurn().catch((error: unknown) => {
        this.logger.error("reconcileActiveTurn failed", { error });
      });
    }
  }

  /** Returns any pending (uncommitted) chunks for client sync. */
  getPendingChunks(): UIMessageChunk[] | undefined {
    this.ensureRehydratedState();
    return this.messageAccumulator.getPendingChunks();
  }

  /**
   * Reconciles a durably-marked active workflow turn on DO restart by asking the
   * workflows runtime for the current status. If the workflow is still live it
   * will drive the turn to completion via RPC. If the workflow is terminal, we
   * commit any partial message as aborted and clear active-turn state.
   */
  async reconcileActiveTurn(): Promise<void> {
    const serverState = this.getServerState();
    const { activeUserMessageId, instanceId: workflowInstanceId } = serverState.workflowState;
    if (!activeUserMessageId || !workflowInstanceId) return;

    let status;
    try {
      status = await this.getWorkflowStatus(
        SESSION_TURN_WORKFLOW_BINDING,
        workflowInstanceId,
      );
    } catch (error) {
      this.logger.warn("Workflow status inspection failed during reconcile", {
        error,
        fields: { workflowInstanceId },
      });
      return;
    }

    switch (status.status) {
      case "queued":
      case "running":
      case "waiting":
      case "paused":
      case "waitingForPause":
        // Workflow is alive — it will drive the turn to completion via RPC.
        return;
      case "complete":
      case "errored":
      case "terminated":
      case "unknown": {
        this.logger.warn("Reconciling terminal workflow on DO restart", {
          fields: {
            workflowInstanceId,
            status: status.status,
            activeUserMessageId,
          },
        });
        this.commitAbortedMessage(this.messageAccumulator);
        this.messageAccumulator.reset();
        this.updateWorkflowState({ instanceId: null });
        this.clearActiveTurnState();
        this.updatePartialState({ status: this.synthesizeStatus() });
        return;
      }
      default: {
        const exhaustiveCheck: never = status.status;
        throw new Error(
          `Unhandled workflow status during reconcile: ${exhaustiveCheck}`,
        );
      }
    }
  }

  // ============================================
  // Workflow RPC handlers
  // ============================================

  /**
   * Prepares turn metadata for workflow-owned execution.
   * @param userMessageId Durable user message identifier for the turn.
   * @param overrides Optional per-turn model or mode overrides.
   * @returns The normalized turn metadata needed by the workflow runner.
   */
  prepareTurn(
    userMessageId: string,
    overrides: PrepareWorkflowTurnOverrides,
  ): Result<PreparedWorkflowTurn, WorkflowTurnFailure> {
    const serverState = this.getServerState();
    const clientState = this.getClientState();

    if (!serverState.initialized || !serverState.sessionId) {
      return failure(
        workflowTurnFailure("SESSION_NOT_INITIALIZED", "Session is not initialized"),
      );
    }
    if (!serverState.spriteName || !serverState.repoCloned) {
      return failure(
        workflowTurnFailure("SESSION_NOT_READY", "Session provisioning is not complete"),
      );
    }
    if (!serverState.userId) {
      return failure(
        workflowTurnFailure("USER_NOT_FOUND", "Session user id is missing"),
      );
    }
    // the message id should have already been set when we dispatched the turn.
    if (
      serverState.workflowState.activeUserMessageId !== userMessageId
    ) {
      this.logger.warn("Another workflow turn is already active, not preparing new turn", {
        fields: { userMessageId },
      });
      return failure(
        workflowTurnFailure("TURN_NOT_ACTIVE", "Another workflow turn is already active"),
      );
    }
    if (!this.messageRepository.getById(userMessageId)) {
      return failure(
        workflowTurnFailure("MESSAGE_NOT_FOUND", "Workflow turn message was not found"),
      );
    }

    const parsedSettings = AgentSettings.safeParse({
      provider: clientState.agentSettings.provider,
      model: overrides.model ?? clientState.agentSettings.model,
      maxTokens: clientState.agentSettings.maxTokens,
    });
    if (!parsedSettings.success) {
      return failure(
        workflowTurnFailure(
          "INVALID_AGENT_SETTINGS",
          "Agent settings are invalid for workflow execution",
          {
            issues: parsedSettings.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        ),
      );
    }

    this.updateWorkflowState({ activeUserMessageId: userMessageId });

    this.logger.debug(`Prepared workflow turn for user message id: ${userMessageId}`);
    return success({
      userId: serverState.userId,
      settings: parsedSettings.data,
      agentMode: overrides.agentMode ?? clientState.agentMode,
      agentSessionId: serverState.agentSessionId,
    });
  }

  /**
   * Records Sprite process metadata for a workflow-owned turn.
   * @param userMessageId Durable user message identifier for the turn.
   * @param agentProcessId Sprite process ID captured when the runner starts.
   */
  handleTurnStarted(
    userMessageId: string,
    agentProcessId: number | null,
  ): boolean {
    this.ensureRehydratedState();
    if (userMessageId !== this.getServerState().workflowState.activeUserMessageId) {
      this.logger.warn("Another workflow turn is already active, not starting new turn", {
        fields: { userMessageId },
      });
      return false;
    }
    // prepareTurn should have already set the active messsage id.
    this.updateWorkflowState({
      activeUserMessageId: userMessageId,
      activeAgentProcessId: agentProcessId,
    });
    return true;
  }

  /**
   * Persists the provider session id emitted by the workflow-owned runner.
   * @param messageId Durable user message identifier for the turn.
   * @param agentSessionId Provider conversation session id.
   */
  handleAgentSessionId(messageId: string, agentSessionId: string): void {
    this.ensureRehydratedState();
    if (this.isStaleRpc(messageId)) return;
    this.handleAgentOutput({
      type: "sessionId",
      sessionId: agentSessionId,
    });
  }

  /**
   * Handles a streamed workflow chunk using the existing accumulation path.
   * @param messageId Durable user message identifier for the turn.
   * @param sequence Monotonic chunk sequence number for the turn.
   * @param chunk UI chunk emitted by the workflow-owned runner.
   */
  handleChunk(
    userMessageId: string,
    sequence: number,
    chunk: UIMessageChunk,
  ): void {
    this.ensureRehydratedState();
    // this.logger.debug(`Received chunk ${sequence} with type ${chunk.type} for turn ${messageId}`);
    void sequence;
    if (this.isStaleRpc(userMessageId)) return;
    this.handleAgentOutput({
      type: "stream",
      chunk,
    });
  }

  /**
   * Clears active workflow turn metadata after a successful terminal chunk.
   * @param messageId Durable user message identifier for the turn.
   * @param result Terminal result returned by the workflow runner.
   */
  handleTurnFinished(
    userMessageId: string,
    result: AgentProcessRunnerTurnResult,
  ): void {
    this.ensureRehydratedState();
    if (this.isStaleRpc(userMessageId)) return;
    this.logger.info("Workflow turn finished", {
      fields: {
        userMessageId,
        finishReason: result.finishReason ?? "unknown",
      },
    });
    this.clearActiveTurnState();
    this.updatePartialState({
      lastError: null,
      status: this.synthesizeStatus(),
    });
  }

  /**
   * Finalizes a failed workflow-owned turn and aborts any partial message.
   * @param messageId Durable user message identifier for the turn.
   * @param error Modeled failure returned by the workflow runner.
   */
  handleTurnFailed(
    userMessageId: string,
    error: WorkflowTurnFailure,
  ): void {
    if (this.isStaleRpc(userMessageId)) return;
    this.ensureRehydratedState();
    this.logger.error("Workflow turn failed", {
      fields: {
        userMessageId,
        code: error.code,
      },
      error: error.message,
    });

    const saved = this.commitAbortedMessage(this.messageAccumulator);
    if (saved) {
      this.logger.info("Saved interrupted message to SQLite on workflow failure", {
        fields: { userMessageId },
      });
    }

    this.messageAccumulator.reset();
    this.clearActiveTurnState();
    this.updatePartialState({
      lastError: error.message,
      status: this.synthesizeStatus(),
    });
    // Unblock the client: without this, the UI stays in "responding" state
    // because waitingForResponse is only cleared on agent.finish or
    // operation.error.
    this.broadcastMessage({
      type: "operation.error",
      code: "CHAT_MESSAGE_FAILED",
      message: error.message,
    });
  }

  /** Handles unexpected workflow completion (workflow finished its run loop). */
  async handleWorkflowComplete(
    workflowName: string,
    workflowId: string,
    result: unknown,
  ): Promise<void> {
    void result;
    const serverState = this.getServerState();
    if (
      workflowName === SESSION_TURN_WORKFLOW_BINDING &&
      serverState.workflowState.instanceId === workflowId
    ) {
      this.logger.warn("Session workflow completed unexpectedly", {
        fields: { workflowId },
      });
      this.updateWorkflowState({ instanceId: null });
    } else {
      this.logger.warn(`Unknown workflow completed: ${workflowName} ${workflowId}`);
    }
  }

  /** Handles a workflow-level error (the workflow itself failed). */
  async handleWorkflowError(
    workflowName: string,
    workflowId: string,
    error: string,
  ): Promise<void> {
    const serverState = this.getServerState();
    if (
      workflowName === SESSION_TURN_WORKFLOW_BINDING &&
      serverState.workflowState.instanceId === workflowId
    ) {
      this.logger.error("Session workflow errored", {
        fields: { workflowId },
        error,
      });
      // Commit any partial message to maintain the "WAL non-empty => active
      // turn exists" invariant; otherwise the constructor on a later restart
      // would see orphaned WAL chunks with no active turn.
      this.commitAbortedMessage(this.messageAccumulator);
      this.messageAccumulator.reset();
      this.updateWorkflowState({ instanceId: null });
      this.clearActiveTurnState();
      this.updatePartialState({
        lastError: error,
        status: this.synthesizeStatus(),
      });
      return;
    }

    this.logger.error("Workflow errored", {
      fields: { workflowName, workflowId },
      error,
    });
  }

  // ============================================
  // Turn dispatch
  // ============================================

  /**
   * Dispatches a turn payload to the session workflow, creating the workflow
   * instance if needed. Serialized via an internal promise chain to avoid
   * concurrent create/send races.
   */
  async dispatchTurn(turnPayload: WorkflowTurnPayload): Promise<void> {
    const serverState = this.getServerState();
    const sessionId = serverState.sessionId;
    const spriteName = serverState.spriteName;
    if (!sessionId || !spriteName) {
      throw new Error("Session workflow cannot start before provisioning completes");
    }

    if (serverState.workflowState.activeUserMessageId && serverState.workflowState.activeUserMessageId !== turnPayload.userMessage.id) {
      this.logger.warn("Another workflow turn is already active, not dispatching new turn", {
        fields: { userMessageId: turnPayload.userMessage.id },
      });
      return;
    }
    this.updateWorkflowState({ activeUserMessageId: turnPayload.userMessage.id });

    const previousDispatch = this.workflowDispatchPromise;
    const nextDispatch = previousDispatch
      .catch(() => undefined)
      .then(async () => {
        const { workflowId, created } = await this.ensureWorkflowRunning(
          sessionId,
          spriteName,
          turnPayload,
        );
        // If the workflow was just created, the initial turn is already baked
        // into the workflow params — no need to send a separate event.
        if (created) return;

        try {
          await this.sendTurnEvent(workflowId, turnPayload);
        } catch (error) {
          // Existing workflow is dead (errored/terminated) or its event KV is
          // corrupt. Drop it and mint a fresh workflow with this turn as its
          // initialTurn — no restart (restart replays stale params) and no
          // reuse of the old id (CF retains errored instances, would collide).
          this.logger.warn("Send event failed; recreating workflow with fresh id", {
            error,
            fields: { workflowId },
          });
          this.updateWorkflowState({ instanceId: null });
          await this.ensureWorkflowRunning(sessionId, spriteName, turnPayload);
        }
      });

    this.workflowDispatchPromise = nextDispatch.catch(() => undefined); // TODO: why do we catch 

    try {
      await nextDispatch;
      this.updatePartialState({
        lastError: null,
        status: this.synthesizeStatus(),
      });
    } catch (error) {
      this.clearActiveTurnState();
      throw error;
    }
  }

  // ============================================
  // Turn cancellation
  // ============================================

  /** Cancels the active workflow turn: tries a graceful signal, falls back to kill. */
  async cancelActiveTurn(): Promise<void> {
    const cancelSignalSent = await this.sendCancelSignal();
    if (cancelSignalSent) {
      return;
    }

    this.logger.debug("Sending cancel signal to workflow failed, stopping managed processes");
    await this.stopManagedProcesses();
  }

  /** Kills the sprite process for the active workflow turn. */
  async stopManagedProcesses(): Promise<void> {
    const serverState = this.getServerState();
    const spriteName = serverState.spriteName;
    if (!spriteName) {
      return;
    }

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    const cleanup = () => {
      this.commitAbortedMessage(this.messageAccumulator);
      this.messageAccumulator.reset();
      this.clearActiveTurnState();
    };
    const processId = serverState.workflowState.activeAgentProcessId;
    if (!processId) {
      this.logger.debug("No agent process id to stop");
      cleanup();
      return;
    }
    try {
      await sprite.killSession(processId, "SIGINT");
    } catch (error) {
      // Session is already gone on the sprite — treat as successfully stopped
      // and clear the in-memory accumulator so no further chunks accumulate.
      if (error instanceof SpritesError && error.statusCode === 404) {
        this.logger.warn("Sprite session already gone; clearing accumulator", {
          fields: { processId },
        });
        cleanup();
        return;
      }
      this.logger.error("Failed to stop workflow-managed processes", { error });
    }
  }

  // ============================================
  // Private helpers
  // ============================================

  private handleAgentOutput(output: AgentOutput): void {
    const serverState = this.getServerState();
    switch (output.type) {
      case "ready": {
        this.updatePartialState({ status: this.synthesizeStatus() });
        break;
      }
      case "error": {
        this.logger.error(`vm-agent error: ${output.error}`);
        this.messageAccumulator.reset();
        this.pendingChunkRepository.clear();
        this.updatePartialState({
          lastError: output.error,
          status: this.synthesizeStatus(),
        });
        break;
      }
      case "debug":
        // wont be received by the DO, not forwarded by the workflow.
        break;
      case "stream": {
        this.handleStreamChunk(output.chunk as UIMessageChunk);
        break;
      }
      case "sessionId": {
        // Persist the agent provider's session ID so it can be resumed on reconnect
        this.logger.info(`Storing agent session ID: ${output.sessionId}`);
        if (serverState.agentSessionId && serverState.agentSessionId !== output.sessionId) {
          this.logger.warn(`Agent session ID mismatch: ${serverState.agentSessionId} !== ${output.sessionId}`);
        }
        this.updateAgentSessionId(output.sessionId);
        break;
      }
    }
  }

  private handleStreamChunk(chunk: UIMessageChunk): void {
    const serverState = this.getServerState();
    this.broadcastMessage({
      type: "agent.chunk",
      chunk,
    });

    // Write chunk to SQLite WAL before processing — survives DO eviction or process kill
    this.pendingChunkRepository.append(chunk);

    // Accumulate chunks into UIMessage and extract derived state (todos, plan)
    const { finishedMessage, completedParts } = this.messageAccumulator.process(chunk);
    applyDerivedStateFromParts(
      {
        sessionId: serverState.sessionId!,
        latestPlanRepository: this.latestPlanRepository,
        updatePartialState: (partial) => this.updatePartialState(partial),
      },
      completedParts,
      this.messageAccumulator.getMessageId(),
    );

    if (finishedMessage) {
      this.logger.debug(`finished message: ${finishedMessage.id}`);
      const sessionId = serverState.sessionId!;
      const stored = this.messageRepository.create(
        sessionId,
        finishedMessage,
      );
      // Flush WAL — message is now durably saved
      this.pendingChunkRepository.clear();
      this.broadcastMessage({
        type: "agent.finish",
        message: stored.message,
      });

      // Reset in-progress message state for the next response
      this.messageAccumulator.reset();
    }
  }

  /**
   * Aborts the given accumulator, persists the result, flushes the WAL, and
   * broadcasts agent.finish to any connected clients.
   * @returns true if a message was saved, false if the accumulator had no content.
   */
  private commitAbortedMessage(accumulator: MessageAccumulator): boolean {
    const message = accumulator.forceAbort();
    this.pendingChunkRepository.clear();
    if (!message) return false;
    const sessionId = this.getServerState().sessionId!;
    const stored = this.messageRepository.create(sessionId, message);
    this.broadcastMessage({ type: "agent.finish", message: stored.message });
    return true;
  }

  /**
   * Ignores workflow callback RPCs for a messageId that does not match the
   * currently-active turn. Permissive when active is null — a terminal RPC
   * may legitimately arrive just after reconcile cleared state.
   */
  private isStaleRpc(userMessageId: string): boolean {
    const activeUserMessageId = this.getServerState().workflowState.activeUserMessageId;
    if (activeUserMessageId && activeUserMessageId !== userMessageId) {
      this.logger.warn("Ignoring workflow RPC for non-active message", {
        fields: { incomingMessageId: userMessageId, activeUserMessageId },
      });
      return true;
    }
    return false;
  }

  private clearActiveTurnState(): void {
    this.updateWorkflowState({
      activeUserMessageId: null,
      activeAgentProcessId: null,
    });
  }

  /**
   * Ensures a workflow instance is running for the session. Reuses the
   * persisted instance if still live; otherwise mints a fresh UUID and creates
   * a new instance with `initialTurn` baked into its params.
   * @returns the workflow id in use and whether a new instance was created.
   */
  private async ensureWorkflowRunning(
    sessionId: string,
    spriteName: string,
    initialTurn: WorkflowTurnPayload,
  ): Promise<{ workflowId: string; created: boolean }> {
    const existingId = this.getServerState().workflowState.instanceId;
    if (existingId && this.getWorkflow(existingId)) {
      return { workflowId: existingId, created: false };
    }

    const workflowId = crypto.randomUUID();
    const actualInstanceId = await this.runWorkflow(
      SESSION_TURN_WORKFLOW_BINDING,
      { sessionId, spriteName, initialTurn } satisfies SessionTurnWorkflowParams,
      { id: workflowId, agentBinding: "SESSION_AGENT" },
    );
    if (actualInstanceId !== workflowId) {
      // shouldnt occur.
      this.logger.error("Workflow id mismatch", {
        fields: { workflowId, actualInstanceId },
      });
    }
    this.updateWorkflowState({ instanceId: workflowId });
    this.logger.debug(`Workflow ${workflowId} started`);
    return { workflowId, created: true };
  }

  private async sendTurnEvent(
    workflowId: string,
    turnPayload: WorkflowTurnPayload,
  ): Promise<void> {
    this.logger.debug(`Sending turn event to workflow ${workflowId} - ${turnPayload.userMessage.id}`);
    await this.sendWorkflowEvent(
      SESSION_TURN_WORKFLOW_BINDING,
      workflowId,
      {
        type: WORKFLOW_MESSAGE_AVAILABLE_EVENT,
        payload: turnPayload,
      },
    );
  }

  private async sendCancelSignal(): Promise<boolean> {
    this.logger.debug("Sending cancel signal to workflow");
    const serverState = this.getServerState();
    const spriteName = serverState.spriteName;
    const agentProcessId = serverState.workflowState.activeAgentProcessId;
    if (!spriteName || !agentProcessId) {
      this.logger.debug("No sprite name or agent process id to send cancel signal to");
      return false;
    }

    // Attach to the exec session and send the cancel signal via stdin
    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    const session = sprite.attachSession(String(agentProcessId), {
      idleTimeoutMs: 5_000,
    });

    try {
      await session.start();
      session.write(encodeAgentInput({ type: "cancel" }) + "\n");
      this.logger.debug("Cancel signal sent to workflow");
      return true;
    } catch (error) {
      this.logger.warn("Failed to send workflow cancel signal via attachSession", {
        error,
        fields: { agentProcessId },
      });
      return false;
    } finally {
      try {
        session.close();
      } catch (error) {
        this.logger.debug("Failed to close workflow cancel control session", {
          error,
        });
      }
    }
  }
}
