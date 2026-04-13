import { SpritesCoordinator, SpritesError, WorkersSpriteClient } from "@/lib/sprites";
import {
  type ClientState,
  type AgentMode,
  type AgentSettingsInput,
  type Logger,
  ClientMessage as ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
  SessionInfoResponse,
  SessionPlanResponse,
  SessionStatus,
  LogLevel,
  ChatMessageEvent,
  AgentOutput,
  AgentSettings,
  encodeAgentInput,
  failure,
  getProviderModelDefinition,
  success,
  Result,
} from "@repo/shared";
import type { Env } from "@/types";
import { Agent, type Connection } from "agents";
import { MessageRepository } from "./repositories/message-repository";
import { PendingChunkRepository } from "./repositories/pending-chunk-repository";
import { SecretRepository } from "./repositories/secret-repository";
import { LatestPlanRepository } from "./repositories/latest-plan-repository";
import {
  ServerStateRepository,
  type ServerState,
} from "./repositories/server-state-repository";
import { migrateAll } from "./repositories/schema-manager";
import { AttachmentService } from "@/lib/attachments/attachment-service";
import { buildNetworkPolicy } from "@/lib/sprites/network-policy";
import { handleGitProxy, type GitProxyContext } from "@/lib/git-proxy";
import { configureGitRemote } from "@/lib/git-setup";
import { ensureValidInstallationToken } from "./session-agent-github-token";
import { createLogger, initializeLogger } from "@/lib/logger";
import { GitHubAppService } from "@/lib/github/github-app";
import type { UIMessage, UIMessageChunk } from "ai";
// DISABLED: editor feature imports — security issue (sprite URL set to public)
// import {
//   handleEditorOpen,
//   handleEditorClose,
// } from "./session-agent-editor";
import { updateSessionHistoryData } from "./session-agent-history";
import type {
  HandleCloseEditorResult,
  HandleDeleteSessionResult,
  HandleGetMessagesResult,
  HandleGetPlanResult,
  HandleGetSessionResult,
  HandleInitResult,
  HandleOpenEditorResult,
  HandleUpdatePullRequestResult,
  SetPullRequestRequest,
  UpdatePullRequestRequest,
} from "@/types/session-agent";
import {
  createUserUiMessage,
  getUserMessageTextContent,
} from "@/lib/utils/uimessage-utils";
import { MessageAccumulator } from "@/lib/message-accumulator";
import { applyDerivedStateFromParts } from "./session-agent-derived-state";
import { AttachmentRecord } from "@/types/attachments";
import { buildUserUiMessage } from "@/lib/create-user-message";
import {
  assertSessionRepoAccess,
  type SessionRepoAccessResult,
} from "@/lib/user-session/session-repo-access";
import { getProviderAuthService } from "@/lib/providers/provider-auth-service";
import type {
  AgentProcessRunnerTurnResult,
  AgentProcessRunnerTurnStartMetadata,
  PreparedWorkflowTurn,
} from "@/workflows/AgentProcessRunner";
import type {
  PrepareWorkflowTurnOverrides,
  SessionTurnWorkflowParams,
  WorkflowTurnFailure,
  WorkflowTurnPayload,
} from "@/workflows/types";

const WORKSPACE_DIR = "/home/sprite/workspace";
const SESSION_TURN_WORKFLOW_BINDING = "SESSION_TURN_WORKFLOW";
const WORKFLOW_MESSAGE_AVAILABLE_EVENT = "message_available";

interface InitRequest {
  sessionId: string;
  userId: string;
  repoFullName: string;
  agentSettings?: AgentSettingsInput;
  agentMode?: AgentMode;
  /** Base branch */
  branch?: string;
  initialMessage?: string;
  initialAttachmentIds?: string[];
}

export class SessionAgentDO extends Agent<Env, ClientState> {
  private readonly logger: Logger;
  private readonly spritesCoordinator: SpritesCoordinator;
  private readonly messageRepository: MessageRepository;
  private readonly secretRepository: SecretRepository;
  private readonly latestPlanRepository: LatestPlanRepository;
  private readonly serverStateRepository: ServerStateRepository;
  private readonly pendingChunkRepository: PendingChunkRepository;
  /** In-memory ServerState mirror — written through via updateServerState() */
  private serverState: ServerState;
  /** Mutex for durable provisioning steps (sprite creation, repo clone) */
  private ensureProvisionedPromise: Promise<void> | null = null;
  /** Serializes workflow create/send operations for this session. */
  private workflowDispatchPromise: Promise<void> = Promise.resolve();
  /** GitHub App installation access token (in-memory cache, persisted in SQLite) */
  private githubToken: string | null = null;
  /** Random nonce for git proxy auth (in-memory cache, persisted in SQLite secrets) */
  private gitProxySecret: string | null = null;
  /** Connection token for the VS Code editor (in-memory cache, persisted in SQLite secrets) */
  private editorToken: string | null = null;
  private messageAccumulator: MessageAccumulator = new MessageAccumulator();

  initialState: ClientState = {
    repoFullName: null,
    status: "initializing",
    agentSettings: { provider: "claude-code", model: "opus", maxTokens: 8192 },
    agentMode: "edit",
    pushedBranch: null,
    pullRequest: null,
    todos: null,
    plan: null,
    pendingUserMessage: null,
    editorUrl: null,
    providerConnection: null,
    lastError: null,
    baseBranch: null,
    createdAt: new Date(),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    initializeLogger({
      level: env.LOG_LEVEL as LogLevel,
      format: "pretty",
    });
    this.logger = createLogger("session-agent-do.ts");

    // The Agents SDK allows clients to overwrite state via { type: "cf_agent_state" } WebSocket messages.
    // There is no validation hook before the write, so we intercept at _setStateInternal.
    // When source is a Connection (client), we reject the update entirely.
    const superSetStateInternal = (this as any)._setStateInternal.bind(this);
    (this as any)._setStateInternal = (
      state: ClientState,
      source: Connection | "server",
    ) => {
      if (source !== "server") {
        this.logger.warn("Rejecting client-initiated state update attempt");
        return;
      }
      return superSetStateInternal(state, source);
    };

    const sql = this.sql.bind(this);
    this.messageRepository = new MessageRepository(sql);
    this.secretRepository = new SecretRepository(sql);
    this.latestPlanRepository = new LatestPlanRepository(sql);
    this.serverStateRepository = new ServerStateRepository(sql);
    this.pendingChunkRepository = new PendingChunkRepository(sql);
    this.spritesCoordinator = new SpritesCoordinator({
      apiKey: this.env.SPRITES_API_KEY,
    });

    migrateAll([
      this.messageRepository,
      this.secretRepository,
      this.latestPlanRepository,
      this.serverStateRepository,
      this.pendingChunkRepository,
    ]);

    // Load secrets from SQLite into memory
    this.githubToken = this.secretRepository.get("github_token");
    this.gitProxySecret = this.secretRepository.get("git_proxy_secret");
    this.editorToken = this.secretRepository.get("editor_token");

    // Load server state from SQLite
    this.serverState = this.serverStateRepository.get();

    // Non-destructively rebuild in-memory accumulator + derived state from the WAL.
    // Never commit or clear here — that would race with incoming workflow RPCs.
    this.rehydratePendingMessageState();

    // If a workflow turn is durably marked active, schedule an async reconcile
    // that will clean up if the workflow is actually terminal.
    if (this.serverState.activeWorkflowMessageId) {
      this.ctx.waitUntil(
        this.reconcileActiveWorkflowTurn().catch((error: unknown) => {
          this.logger.error("reconcileActiveWorkflowTurn failed", { error });
        }),
      );
    }

    this.logger.info(`constructed agent DO for session ${this.serverState.sessionId}`);
  }

  async onStart(): Promise<void> {
    // note: doing this here brecause we cant access this.name in the constructor. cf bug
     // Reset transient ClientState fields on every restart so they never get
    // stuck from a previous instance's in-progress operation.
    this.updatePartialState({
      status: this.synthesizeStatus(),
      lastError: null,
    });
    this.logger.debug("onStart");
  }

  // ============================================
  // State helpers
  // ============================================

  private updatePartialState(partial: Partial<ClientState>): void {
    this.setState({ ...this.state, ...partial });
  }

  private updateServerState(partial: Partial<ServerState>): void {
    this.serverState = { ...this.serverState, ...partial };
    this.serverStateRepository.update(partial);
  }

  /**
   * Derives the session status from durable ServerState checkpoints and
   * the in-memory agent connection state. Used to reset transient status
   * on restart and after each provisioning step.
   */
  private synthesizeStatus(): SessionStatus {
    if (!this.serverState.initialized) return "initializing";
    if (!this.serverState.spriteName) return "provisioning";
    if (!this.serverState.repoCloned) return "cloning";
    return "ready";
  }

  private async resolveProviderConnectionState(
    providerId: ClientState["agentSettings"]["provider"],
    userId: string | null,
  ): Promise<ClientState["providerConnection"]> {
    if (!userId) {
      return {
        provider: providerId,
        connected: false,
        requiresReauth: false,
      };
    }

    try {
      const service = getProviderAuthService(providerId, this.env, this.logger);
      const status = await service.getConnectionStatus(userId);
      return {
        provider: providerId,
        connected: status.connected,
        requiresReauth: status.requiresReauth,
      };
    } catch (error) {
      this.logger.error("Failed to resolve provider connection state", {
        error,
        fields: { provider: providerId, userId },
      });
      return null;
    }
  }

  private queueRefreshProviderConnection(): void {
    this.ctx.waitUntil(
      this.refreshProviderConnection().catch((error) => {
        this.logger.error("Failed to refresh provider connection state", { error });
      }),
    );
  }

  /**
   * Refreshes the active session provider connection state from the provider auth service.
   * @returns Resolves when the cached provider connection state has been updated, if available.
   */
  async refreshProviderConnection(): Promise<void> {
    const providerConnection = await this.resolveProviderConnectionState(
      this.state.agentSettings.provider,
      this.serverState.userId,
    );
    if (providerConnection) {
      this.updatePartialState({ providerConnection });
    }
  }

  // ============================================
  // Agent lifecycle
  // ============================================

  private handleAgentOutput(output: AgentOutput): void {
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
      case "debug": {
        this.logger.debug(`[vm-agent debug] ${output.message}`);
        break;
      }
      case "stream": {
        this.broadcastMessage({
          type: "agent.chunk",
          chunk: output.chunk,
        });

        // Write chunk to SQLite WAL before processing — survives DO eviction or process kill
        this.pendingChunkRepository.append(output.chunk as UIMessageChunk);

        // Accumulate chunks into UIMessage and extract derived state (todos, plan)
        const { finishedMessage, completedParts } =
          this.messageAccumulator.process(output.chunk as UIMessageChunk);
        applyDerivedStateFromParts(
          {
            sessionId: this.serverState.sessionId!,
            latestPlanRepository: this.latestPlanRepository,
            updatePartialState: (partial) => this.updatePartialState(partial),
          },
          completedParts,
          this.messageAccumulator.getMessageId(),
        );

        if (finishedMessage) {
          const sessionId = this.serverState.sessionId!;
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
        break;
      }
      case "sessionId": {
        // Persist the agent provider's session ID so it can be resumed on reconnect
        this.logger.info(`Storing agent session ID: ${output.sessionId}`);
        if (this.serverState.agentSessionId && this.serverState.agentSessionId !== output.sessionId) {
          this.logger.warn(`Agent session ID mismatch: ${this.serverState.agentSessionId} !== ${output.sessionId}`);
        }
        this.updateServerState({ agentSessionId: output.sessionId });
        break;
      }
    }
  }
  private handleAgentError(error: string): void {
    this.logger.error("Agent error", { error });
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
    const sessionId = this.serverState.sessionId!;
    const stored = this.messageRepository.create(sessionId, message);
    this.broadcastMessage({ type: "agent.finish", message: stored.message });
    return true;
  }

  /**
   * Rebuilds in-memory accumulator and derived state from the WAL on DO restart.
   * Non-destructive: never commits a message and never clears the WAL. Cleanup of
   * the WAL is owned by terminal workflow RPCs and reconcileActiveWorkflowTurn().
   */
  private rehydratePendingMessageState(): void {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) return;

    const orphanedChunks = this.pendingChunkRepository.getAll();
    if (orphanedChunks.length === 0) return;

    this.logger.info("Rehydrating message accumulator from WAL on DO restart", {
      fields: {
        chunkCount: orphanedChunks.length,
        activeWorkflowMessageId: this.serverState.activeWorkflowMessageId,
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

  // ============================================
  // Workflow RPC
  // ============================================

  /**
   * Reconciles a durably-marked active workflow turn on DO restart by asking the
   * workflows runtime for the current status. If the workflow is still live it
   * will drive the turn to completion via RPC — we do nothing. If the workflow
   * is terminal, no RPC will arrive, so we commit any partial message as aborted
   * and clear active-turn state.
   */
  private async reconcileActiveWorkflowTurn(): Promise<void> {
    const { activeWorkflowMessageId, workflowInstanceId } = this.serverState;
    if (!activeWorkflowMessageId || !workflowInstanceId) return;

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
            activeWorkflowMessageId,
          },
        });
        this.commitAbortedMessage(this.messageAccumulator);
        this.messageAccumulator.reset();
        this.clearActiveWorkflowTurnState();
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

  /**
   * Ignores workflow callback RPCs for a messageId that does not match the
   * currently-active turn. Permissive when active is null — a terminal RPC
   * may legitimately arrive just after reconcile cleared state, and handling
   * it is harmless.
   */
  private isStaleWorkflowRpc(messageId: string): boolean {
    const active = this.serverState.activeWorkflowMessageId;
    if (active && active !== messageId) {
      this.logger.warn("Ignoring workflow RPC for non-active message", {
        fields: { incomingMessageId: messageId, active },
      });
      return true;
    }
    return false;
  }

  private clearActiveWorkflowTurnState(): void {
    this.updateServerState({
      activeWorkflowMessageId: null,
      activeWorkflowExecSessionId: null,
      activeWorkflowProcessId: null,
    });
  }

  /**
   * Prepares turn metadata for workflow-owned execution.
   * @param messageId Durable user message identifier for the turn.
   * @param overrides Optional per-turn model or mode overrides.
   * @returns The normalized turn metadata needed by the workflow runner.
   */
  prepareWorkflowTurn(
    messageId: string,
    overrides: PrepareWorkflowTurnOverrides,
  ): Result<PreparedWorkflowTurn, WorkflowTurnFailure> {
    if (!this.serverState.initialized || !this.serverState.sessionId) {
      return failure({
        code: "SESSION_NOT_INITIALIZED",
        message: "Session is not initialized",
      });
    }
    if (!this.serverState.spriteName || !this.serverState.repoCloned) {
      return failure({
        code: "SESSION_NOT_READY",
        message: "Session provisioning is not complete",
      });
    }
    if (!this.serverState.userId) {
      return failure({
        code: "USER_NOT_FOUND",
        message: "Session user id is missing",
      });
    }
    if (
      this.serverState.activeWorkflowMessageId &&
      this.serverState.activeWorkflowMessageId !== messageId
    ) {
      return failure({
        code: "TURN_NOT_ACTIVE",
        message: "Another workflow turn is already active",
      });
    }
    if (!this.messageRepository.getById(messageId)) {
      return failure({
        code: "MESSAGE_NOT_FOUND",
        message: "Workflow turn message was not found",
      });
    }

    const parsedSettings = AgentSettings.safeParse({
      provider: this.state.agentSettings.provider,
      model: overrides.model ?? this.state.agentSettings.model,
      maxTokens: this.state.agentSettings.maxTokens,
    });
    if (!parsedSettings.success) {
      return failure({
        code: "INVALID_AGENT_SETTINGS",
        message: "Agent settings are invalid for workflow execution",
        issues: parsedSettings.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    this.updateServerState({ activeWorkflowMessageId: messageId });

    return success({
      userId: this.serverState.userId,
      settings: parsedSettings.data,
      agentMode: overrides.agentMode ?? this.state.agentMode,
      agentSessionId: this.serverState.agentSessionId,
    });
  }

  /**
   * Records Sprite process metadata for a workflow-owned turn.
   * @param messageId Durable user message identifier for the turn.
   * @param metadata Sprite process metadata captured when the runner starts.
   */
  onWorkflowTurnStarted(
    messageId: string,
    metadata: AgentProcessRunnerTurnStartMetadata,
  ): void {
    this.updateServerState({
      activeWorkflowMessageId: messageId,
      activeWorkflowExecSessionId: metadata.spriteExecSessionId,
      activeWorkflowProcessId: metadata.spriteProcessId,
    });
  }

  /**
   * Persists the provider session id emitted by the workflow-owned runner.
   * @param messageId Durable user message identifier for the turn.
   * @param agentSessionId Provider conversation session id.
   */
  onWorkflowSessionId(messageId: string, agentSessionId: string): void {
    if (this.isStaleWorkflowRpc(messageId)) return;
    this.handleAgentOutput({
      type: "sessionId",
      sessionId: agentSessionId,
    });
  }

  /**
   * Handles a streamed workflow chunk using the existing DO accumulation path.
   * @param messageId Durable user message identifier for the turn.
   * @param sequence Monotonic chunk sequence number for the turn.
   * @param chunk UI chunk emitted by the workflow-owned runner.
   */
  onWorkflowChunk(
    messageId: string,
    sequence: number,
    chunk: UIMessageChunk,
  ): void {
    void sequence;
    if (this.isStaleWorkflowRpc(messageId)) return;
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
  onWorkflowTurnFinished(
    messageId: string,
    result: AgentProcessRunnerTurnResult,
  ): void {
    if (this.isStaleWorkflowRpc(messageId)) return;
    this.logger.info("Workflow turn finished", {
      fields: {
        messageId,
        finishReason: result.finishReason ?? "unknown",
      },
    });
    this.clearActiveWorkflowTurnState();
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
  onWorkflowTurnFailed(
    messageId: string,
    error: WorkflowTurnFailure,
  ): void {
    if (this.isStaleWorkflowRpc(messageId)) return;
    this.logger.error("Workflow turn failed", {
      fields: {
        messageId,
        code: error.code ?? "unknown",
      },
      error: error.message,
    });

    const saved = this.commitAbortedMessage(this.messageAccumulator);
    if (saved) {
      this.logger.info("Saved interrupted message to SQLite on workflow failure", {
        fields: { messageId },
      });
    }

    this.messageAccumulator.reset();
    this.clearActiveWorkflowTurnState();
    this.updatePartialState({
      lastError: error.message,
      status: this.synthesizeStatus(),
    });
  }

  async onWorkflowComplete(
    workflowName: string,
    workflowId: string,
    result: unknown,
  ): Promise<void> {
    void result;
    if (
      workflowName === SESSION_TURN_WORKFLOW_BINDING &&
      this.serverState.workflowInstanceId === workflowId
    ) {
      this.logger.warn("Session workflow completed unexpectedly", {
        fields: { workflowId },
      });
      this.updateServerState({ workflowInstanceId: null });
    } else {
      this.logger.warn(`Unknown workflow completed: ${workflowName} ${workflowId}`);
    }
  }

  async onWorkflowError(
    workflowName: string,
    workflowId: string,
    error: string,
  ): Promise<void> {
    if (
      workflowName === SESSION_TURN_WORKFLOW_BINDING &&
      this.serverState.workflowInstanceId === workflowId
    ) {
      this.logger.error("Session workflow errored", {
        fields: { workflowId },
        error,
      });
      // Commit any partial message to maintain the "WAL non-empty ⇒ active
      // turn exists" invariant; otherwise the constructor on a later restart
      // would see orphaned WAL chunks with no active turn.
      this.commitAbortedMessage(this.messageAccumulator);
      this.messageAccumulator.reset();
      this.updateServerState({ workflowInstanceId: null });
      this.clearActiveWorkflowTurnState();
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
  // HTTP Handlers
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.logger.debug(`[HTTP request] ${request.method} ${url.pathname}`);
    const path = url.pathname;

    // Git proxy: forward git operations to GitHub with auth
    if (path.startsWith("/git-proxy/")) {
      const accessResult = await this.assertSessionRepoAccess(); // ensure user still has access to the repo.
      if (!accessResult.ok) {
        switch (accessResult.error.code) {
          case "REPO_ACCESS_BLOCKED":
            await this.enforceSessionAccessBlocked();
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: accessResult.error.status,
                headers: { "Content-Type": "application/json" },
              },
            );
          case "GITHUB_AUTH_REQUIRED":
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              },
            );
          case "GITHUB_API_ERROR":
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: 503,
                headers: { "Content-Type": "application/json" },
              },
            );
          case "SESSION_NOT_FOUND":
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: 404,
                headers: { "Content-Type": "application/json" },
              },
            );
          case "INVALID_REPO":
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          default: {
            const exhaustiveCheck: never = accessResult.error;
            throw new Error(`Unhandled session repo access error: ${JSON.stringify(exhaustiveCheck)}`);
          }
        }
      }

      const result = await handleGitProxy(
        request,
        path,
        this.gitProxyContext(),
      );
      if (result.githubToken) {
        this.githubToken = result.githubToken;
      }
      // Capture pushed branch name and notify clients
      if (result.pushedBranch && result.response.ok) {
        if (result.pushedBranch !== this.state.pushedBranch) {
          this.updatePartialState({ pushedBranch: result.pushedBranch });
          this.broadcastMessage({
            type: "branch.pushed",
            branch: result.pushedBranch,
            repoFullName: this.state.repoFullName ?? "",
          });
        }
      }
      return result.response;
    }

    // Pass unhandled requests to Agent SDK (WebSocket upgrades, internal setup routes, etc.)
    return super.fetch(request);
  }

  // ============================================
  // WebSocket lifecycle (Agents SDK)
  // ============================================

  onConnect(connection: Connection): void {
    this.logger.debug(`client connected: ${connection.id}`);

    // Send initial connection state
    this.sendMessage(
      {
        type: "connected",
        sessionId: this.serverState.sessionId ?? "",
        status: this.state.status,
      },
      connection,
    );

    // Send message history
    const sessionId = this.serverState.sessionId;
    if (sessionId) {
      const storedMessages = this.messageRepository.getAllBySession(sessionId);
      this.sendMessage(
        {
          type: "sync.response",
          messages: storedMessages.map((m) => m.message),
          pendingChunks: this.messageAccumulator.getPendingChunks(),
        },
        connection,
      );
    }

    // Always call ensureReady — idempotent, skips completed steps via serverState checkpoints
    this.queueEnsureReady();
    this.queueRefreshProviderConnection();
  }

  async onMessage(
    connection: Connection,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const messageStr =
      typeof message === "string" ? message : new TextDecoder().decode(message);

    let messageData: unknown;
    try {
      messageData = JSON.parse(messageStr);
    } catch (error) {
      this.logger.error("Ignored non-JSON websocket message", {
        error,
        fields: {
          connectionId: connection.id,
          preview: messageStr.slice(0, 200),
        },
      });
      return;
    }

    const parsedMessage = ClientMessageSchema.safeParse(messageData);
    if (!parsedMessage.success) {
      this.logger.error("Invalid websocket message payload", {
        fields: {
          connectionId: connection.id,
          preview: messageStr.slice(0, 200),
          issues: parsedMessage.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      this.sendMessage(
        {
          type: "operation.error",
          code: "INVALID_MESSAGE",
          message: "unknown request",
        },
        connection,
      );
      return;
    }

    try {
      await this.handleClientMessage(connection, parsedMessage.data);
    } catch (error) {
      this.logger.error("Failed to handle websocket message", {
        error,
        fields: {
          connectionId: connection.id,
          type: parsedMessage.data.type,
        },
      });
      this.sendMessage(
        {
          type: "operation.error",
          code: "MESSAGE_HANDLER_ERROR",
          message: "request failed",
        },
        connection,
      );
    }
  }

  onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    this.logger.debug("WebSocket closed", {
      fields: {
        connectionId: connection.id,
        code,
        reason,
        wasClean,
      },
    });
  }

  onError(connectionOrError: Connection | unknown, error?: unknown): void {
    this.logger.error("WebSocket error", {
      error: error ?? connectionOrError,
    });
  }

  // ============================================
  // Provisioning
  // ============================================

  /**
   * Single entry point for getting the session to a ready state.
   * Called by both handleInit (HTTP) and onConnect (WebSocket).
   * Uses mutexes so concurrent callers share one in-flight operation.
   * Each step is idempotent — skipped if already completed via serverState checkpoints.
   */
  async ensureReady(): Promise<void> {
    if (!this.serverState.initialized) {
      // handleInit has not been called yet — nothing to do
      this.logger.warn("Session not initialized — skipping ensureReady");
      return;
    }
    await this.ensureProvisioned();
    await this.maybeDispatchPendingMessage();
  }

  private queueEnsureReady(): void {
    this.ctx.waitUntil(
      this.ensureReady().catch((error) => {
        this.logger.error("ensureReady failed", { error });
      }),
    );
  }

  private ensureProvisioned(): Promise<void> {
    if (this.ensureProvisionedPromise) return this.ensureProvisionedPromise;
    this.ensureProvisionedPromise = this._provision().finally(() => {
      this.ensureProvisionedPromise = null;
    });
    return this.ensureProvisionedPromise;
  }

  private async _provision(): Promise<void> {
    try {
      if (!this.serverState.spriteName) {
        this.updatePartialState({ status: this.synthesizeStatus() });
        this.logger.debug(
          `Provisioning sprite for session ${this.serverState.sessionId}`,
        );

        const spriteResponse = await this.spritesCoordinator.createSprite({
          name: this.serverState.sessionId!,
        });

        // Lock down outbound network access to known-good domains
        const sprite = new WorkersSpriteClient(
          spriteResponse.name,
          this.env.SPRITES_API_KEY,
          this.env.SPRITES_API_URL,
        );
        const workerHostname = new URL(this.env.WORKER_URL).hostname;
        const networkPolicy = buildNetworkPolicy([
          { domain: workerHostname, action: "allow" },
        ]);
        await sprite.setNetworkPolicy(networkPolicy);

        this.updateServerState({ spriteName: spriteResponse.name });
        this.updatePartialState({ status: this.synthesizeStatus() });
      }

      if (!this.serverState.repoCloned) {
        this.updatePartialState({ status: this.synthesizeStatus() });
        await this.cloneRepo(this.serverState.spriteName!);
        this.updateServerState({ repoCloned: true });
        this.updatePartialState({
          status: this.synthesizeStatus(),
          lastError: null,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to provision session", { error });
      this.updatePartialState({
        lastError: errorMessage,
        status: this.synthesizeStatus(),
      });
      throw error;
    }
  }

  /**
   * Clones the repository onto the sprite and configures git remotes.
   * Assumes the sprite is already created and the network policy is set.
   */
  private async cloneRepo(spriteName: string): Promise<void> {
    const repoFullName = this.state.repoFullName!;
    const sessionId = this.serverState.sessionId!;

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    const proxyBaseUrl = `${this.env.WORKER_URL}/git-proxy/${sessionId}`;
    const cloneUrl = `${proxyBaseUrl}/github.com/${repoFullName}.git`;
    const githubRemoteUrl = `https://github.com/${repoFullName}.git`;

    // Check if the repo is already cloned (sprite may be persistent)
    const isCloned = await sprite.execHttp(
      `test -d ${WORKSPACE_DIR}/.git && echo 'exists' || echo 'empty'`,
      {},
    );
    if (isCloned.stdout.includes("exists")) {
      this.logger.info(
        `Repo ${repoFullName} already cloned on sprite ${spriteName}`,
      );
    } else {
      this.logger.info(`Cloning repo ${repoFullName} on sprite ${spriteName}`);
      await sprite.execHttp(`mkdir -p ${WORKSPACE_DIR}`, {});

      // Fetch a read-only token scoped to contents:read for the initial clone
      const github = new GitHubAppService(this.env, this.logger);
      const cloneTokenResult = await github.getReadOnlyTokenForRepo(repoFullName);
      if (!cloneTokenResult.ok) {
        throw new Error(cloneTokenResult.error.message);
      }
      const cloneToken = cloneTokenResult.value;
      const basicAuth = btoa(`x-access-token:${cloneToken}`);

      // Also refresh the write token for the proxy (used after clone)
      await this.refreshGitHubToken();
      const cloneStart = Date.now();
      const baseBranch = this.state.baseBranch;
      const branchFlag = baseBranch ? `--branch ${baseBranch} ` : "";
      const cloneResult = await sprite.execHttp(
        `git -c http.extraHeader="Authorization: Basic ${basicAuth}" clone --single-branch ${branchFlag}${githubRemoteUrl} ${WORKSPACE_DIR}`,
        {},
      );
      this.logger.info(
        `Clone completed in ${((Date.now() - cloneStart) / 1000).toFixed(1)}s: exitCode=${cloneResult.exitCode}, stderr=${cloneResult.stderr.slice(0, 500)}`,
      );
      if (cloneResult.exitCode !== 0) {
        throw new Error(
          `Clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr}`,
        );
      }
    }

    // Detect the base branch (whatever branch the clone checked out)
    const branchResult = await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git rev-parse --abbrev-ref HEAD`,
      {},
    );
    const actualBaseBranch = branchResult.stdout.trim() || "main";
    if (actualBaseBranch !== this.state.baseBranch && this.state.baseBranch) {
      this.logger.warn(
        `Base branch ${this.state.baseBranch} does not match actual base branch ${actualBaseBranch}`,
      );
    }
    this.updatePartialState({ baseBranch: actualBaseBranch });

    if (!this.gitProxySecret) {
      this.gitProxySecret = crypto.randomUUID();
      this.secretRepository.set("git_proxy_secret", this.gitProxySecret);
    }

    // Configure remote URLs, git identity, and proxy auth header
    await configureGitRemote(sprite, {
      workspaceDir: WORKSPACE_DIR,
      githubRemoteUrl,
      cloneUrl,
      proxyBaseUrl,
      gitProxySecret: this.gitProxySecret,
    });
  }

  // ============================================
  // Init handler
  // ============================================

  async handleInit(request: InitRequest): Promise<HandleInitResult> {
    // Prevent re-initialization
    if (this.serverState.initialized) {
      this.logger.error(
        "Session already initialized — refusing to re-initialize",
        {
          fields: { sessionId: this.serverState.sessionId },
        },
      );
      return failure({ code: "ALREADY_INITIALIZED", message: "Session already initialized", status: 400 });
    }

    const data = request;

    const provider = data.agentSettings?.provider ?? "claude-code";
    const maxTokens = data.agentSettings?.maxTokens ?? 8192;

    let settings: AgentSettings;
    const parsed = AgentSettings.safeParse({
      provider,
      model: data.agentSettings?.model,
      maxTokens,
    });
    if (parsed.success) {
      settings = parsed.data;
    } else {
      // Invalid model — fall back to the provider's default by omitting model
      settings = AgentSettings.parse({ provider, maxTokens });
    }
    const providerConnection = await this.resolveProviderConnectionState(
      settings.provider,
      data.userId,
    );

    // Generate git proxy secret and persist
    if (!this.gitProxySecret) {
      this.gitProxySecret = crypto.randomUUID();
      this.secretRepository.set("git_proxy_secret", this.gitProxySecret);
    } else {
      // should never happen
      this.logger.warn(
        "Git proxy secret already exists, skipping generation(?)",
      );
    }

    const pendingAttachmentIds = data.initialAttachmentIds ?? [];
    const pendingUserUiMessage = await buildUserUiMessage(
      data.sessionId,
      data.initialMessage,
      pendingAttachmentIds,
      {
        attachmentService: new AttachmentService(this.env.DB),
      },
    );
    // Mark initialized in ServerState
    this.updateServerState({
      initialized: true,
      sessionId: data.sessionId,
      userId: data.userId,
    });

    // Store the durable initial fields in ClientState
    this.updatePartialState({
      repoFullName: data.repoFullName,
      agentSettings: settings,
      providerConnection,
      agentMode: data.agentMode ?? "edit",
      pendingUserMessage: pendingUserUiMessage
        ? {
            message: pendingUserUiMessage,
            attachmentIds: pendingAttachmentIds,
          }
        : null,
      // Store the requested base branch; cloneRepo will detect the actual branch and overwrite
      baseBranch: data.branch ?? null,
      status: this.synthesizeStatus(),
    });

    // Provision sprite asynchronously
    this.queueEnsureReady();

    return success(undefined);
  }

  // ============================================
  // Session info / management handlers
  // ============================================

  handleGetSession(): HandleGetSessionResult {
    const sessionId = this.serverState.sessionId;
    if (!sessionId || !this.state.repoFullName) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }

    return success({
      sessionId,
      status: this.state.status,
      repoFullName: this.state.repoFullName,
      baseBranch: this.state.baseBranch ?? undefined,
      pushedBranch: this.state.pushedBranch ?? undefined,
      pullRequestUrl: this.state.pullRequest?.url ?? undefined,
      pullRequestNumber: this.state.pullRequest?.number ?? undefined,
      pullRequestState: this.state.pullRequest?.state ?? undefined,
      editorUrl: this.state.editorUrl ?? undefined,
    } satisfies SessionInfoResponse);
  }

  handleGetMessages(): HandleGetMessagesResult {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }

    const storedMessages = this.messageRepository.getAllBySession(sessionId);
    // todo: return pending too?
    return success(storedMessages.map((m) => m.message));
  }

  handleGetPlan(): HandleGetPlanResult {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }

    const latestPlan = this.latestPlanRepository.getBySession(sessionId);
    if (!latestPlan) {
      return failure({ code: "PLAN_NOT_FOUND", message: "Plan not found" });
    }

    return success({
      plan: latestPlan.plan,
      updatedAt: latestPlan.updatedAt,
      sourceMessageId: latestPlan.sourceMessageId,
    } satisfies SessionPlanResponse);
  }

  // DISABLED: security issue (sprite URL set to public)
  openEditor(): HandleOpenEditorResult {
    return failure({ code: "EDITOR_DISABLED", message: "Editor feature is temporarily disabled" });
  }

  // DISABLED: security issue (sprite URL set to public)
  closeEditor(): HandleCloseEditorResult {
    return failure({ code: "EDITOR_DISABLED", message: "Editor feature is temporarily disabled" });
  }

  setPullRequest(data: SetPullRequestRequest): void {
    this.updatePartialState({
      pullRequest: {
        url: data.url,
        number: data.number,
        state: data.state,
      },
    });
  }

  updatePullRequest(data: UpdatePullRequestRequest): HandleUpdatePullRequestResult {
    const pullRequest = this.state.pullRequest;
    if (!pullRequest) {
      return failure({ code: "PULL_REQUEST_NOT_FOUND", message: "Pull request not found" });
    }
    this.updatePartialState({ pullRequest: { ...pullRequest, state: data.state } });
    return success(undefined);
  }

  async handleDeleteSession(): Promise<HandleDeleteSessionResult> {
    // TODO: CLOSE EDITOR

    // Clean up sprite
    if (this.serverState.spriteName) {
      try {
        await this.spritesCoordinator.deleteSprite(this.serverState.spriteName);
      } catch (error) {
        this.logger.error("Failed to delete sprite", { error });
      }
    }

    // Clear all storage on the DO (DO will cease to exist after this)
    await this.ctx.storage.deleteAll();

    return success(undefined);
  }

  // ============================================
  // Client message handlers
  // ============================================

  private async handleClientMessage(
    connection: Connection,
    message: ClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case "chat.message":
        await this.handleChatMessage(connection, message);
        break;
      case "sync.request":
        await this.handleSyncRequest(connection);
        break;
      case "operation.cancel":
        await this.cancelActiveWorkflowTurn();
        break;
    }
  }

  private async handleChatMessage(
    connection: Connection,
    payload: ChatMessageEvent,
  ): Promise<void> {
    try {
      if (!(await this.guardSessionRepoAccess(connection))) {
        return;
      }

      await this.ensureReady();

      if (this.serverState.activeWorkflowMessageId || this.state.pendingUserMessage) {
        this.sendMessage(
          {
            type: "operation.error",
            code: "CHAT_MESSAGE_FAILED",
            message: "Agent is already handling a message",
          },
          connection,
        );
        return;
      }

      const result = await this.dispatchChatMessageToWorkflow(payload, connection.id);
      if (!result.ok) {
        this.logger.warn("Workflow chat message dispatch failed", {
          fields: { code: result.error.code ?? "unknown" },
        });
        this.sendMessage(
          {
            type: "operation.error",
            code: "CHAT_MESSAGE_FAILED",
            message: result.error.message,
          },
          connection,
        );
        return;
      }
    } catch (error) {
      this.logger.error("Failed to handle chat message", { error });
      this.sendMessage(
        {
          type: "operation.error",
          code: "CHAT_MESSAGE_FAILED",
          message: "Failed to handle chat message",
        },
        connection,
      );
    }
  }

  private async handleSyncRequest(connection: Connection): Promise<void> {
    if (!(await this.guardSessionRepoAccess(connection))) {
      return;
    }

    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      this.sendMessage({ type: "sync.response", messages: [] }, connection);
      return;
    }

    const storedMessages = this.messageRepository.getAllBySession(sessionId);
    this.sendMessage(
      {
        type: "sync.response",
        messages: storedMessages.map((m) => m.message),
        pendingChunks: this.messageAccumulator.getPendingChunks(),
      },
      connection,
    );
  }

  // ============================================
  // Attachment helpers
  // ============================================

  /**
   * Dispatches the pending initial message through the session workflow once provisioning completes.
   */
  private async maybeDispatchPendingMessage(): Promise<void> {
    const pendingMessage = this.state.pendingUserMessage;
    if (!pendingMessage || this.serverState.activeWorkflowMessageId) {
      return;
    }
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return;
    }

    const { message: userMessage, attachmentIds } = pendingMessage;
    const content = getUserMessageTextContent(userMessage);
    const attachmentRecords = await this.getBoundAttachmentRecords(
      sessionId,
      attachmentIds,
    );

    try {
      await this.dispatchTurnToWorkflow({
        messageId: userMessage.id,
        content,
        attachmentIds,
      });
      await this.onUserMessageSent(userMessage, attachmentRecords);
      this.updatePartialState({ pendingUserMessage: null });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to dispatch pending workflow message", { error });
      this.updatePartialState({
        lastError: errorMessage,
        status: this.synthesizeStatus(),
      });
      this.broadcastMessage({
        type: "operation.error",
        code: "CHAT_MESSAGE_FAILED",
        message: "Failed to handle chat message",
      });
    }
  }

  private async dispatchChatMessageToWorkflow(
    payload: ChatMessageEvent,
    connectionId: string,
  ): Promise<Result<void, WorkflowTurnFailure>> {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return failure({
        code: "SESSION_NOT_INITIALIZED",
        message: "Session is not initialized",
      });
    }

    const attachmentIds =
      payload.attachments?.map((attachment) => attachment.attachmentId) ?? [];
    const attachmentRecords = await this.getBoundAttachmentRecords(
      sessionId,
      attachmentIds,
    );
    if (attachmentRecords.length !== attachmentIds.length) {
      return failure({
        code: "ATTACHMENTS_NOT_FOUND",
        message: "Some attachments were not found for this session",
      });
    }

    const content = payload.content?.trim();

    let modelOverride: string | undefined;
    if (payload.model && payload.model !== this.state.agentSettings.model) {
      const modelResult = this.validateAndApplyModelSwitch(payload.model);
      if (!modelResult.ok) {
        return failure(modelResult.error);
      }
      modelOverride = modelResult.value;
    }

    let agentModeOverride: AgentMode | undefined;
    if (payload.agentMode && payload.agentMode !== this.state.agentMode) {
      this.updatePartialState({ agentMode: payload.agentMode });
      agentModeOverride = payload.agentMode;
    }

    const userUiMessage = createUserUiMessage(
      content,
      attachmentRecords,
      payload.messageId,
    );
    if (!userUiMessage) {
      return failure({
        code: "INVALID_MESSAGE",
        message: "Message must include content or attachments",
      });
    }

    await this.onUserMessageSent(userUiMessage, attachmentRecords, connectionId);

    try {
      await this.dispatchTurnToWorkflow({
        messageId: userUiMessage.id,
        content,
        attachmentIds,
        model: modelOverride,
        agentMode: agentModeOverride,
      });
      return success(undefined);
    } catch (error) {
      return failure({
        code: "WORKFLOW_DISPATCH_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private validateAndApplyModelSwitch(
    model: string,
  ): Result<string, WorkflowTurnFailure> {
    const validatedModel = getProviderModelDefinition(
      this.state.agentSettings.provider,
      model,
    );
    if (!validatedModel) {
      this.logger.warn("Invalid provider model in workflow model switch", {
        fields: { provider: this.state.agentSettings.provider, model },
      });
      return failure({
        code: "INVALID_MODEL",
        message: "Invalid model for the current provider",
        provider: this.state.agentSettings.provider,
        model,
      });
    }

    this.updatePartialState({
      agentSettings: {
        ...this.state.agentSettings,
        model: validatedModel.id,
      } as AgentSettings,
    });
    return success(validatedModel.id);
  }

  private async getBoundAttachmentRecords(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]> {
    if (attachmentIds.length === 0) {
      return [];
    }

    const attachmentService = new AttachmentService(this.env.DB);
    return attachmentService.getByIdsBoundToSession(sessionId, attachmentIds);
  }

  private async dispatchTurnToWorkflow(
    turnPayload: WorkflowTurnPayload,
  ): Promise<void> {
    const sessionId = this.serverState.sessionId;
    const spriteName = this.serverState.spriteName;
    if (!sessionId || !spriteName) {
      throw new Error("Session workflow cannot start before provisioning completes");
    }
    const workflowId = sessionId;

    this.updateServerState({ activeWorkflowMessageId: turnPayload.messageId });

    const previousDispatch = this.workflowDispatchPromise;
    const nextDispatch = previousDispatch
      .catch(() => undefined)
      .then(async () => {
        await this.ensureSessionWorkflowRunning(sessionId, spriteName, workflowId);
        try {
          await this.sendTurnEventToWorkflow(workflowId, turnPayload);
        } catch (error) {
          this.logger.warn("Failed to send event to existing workflow", {
            error,
            fields: { workflowId },
          });

          const recovered =
            await this.recoverSessionWorkflowAfterSendFailure(workflowId);
          if (!recovered) {
            throw error;
          }

          await this.sendTurnEventToWorkflow(workflowId, turnPayload);
        }
      });

    this.workflowDispatchPromise = nextDispatch.catch(() => undefined);

    try {
      await nextDispatch;
      this.updatePartialState({
        lastError: null,
        status: this.synthesizeStatus(),
      });
    } catch (error) {
      this.clearActiveWorkflowTurnState();
      throw error;
    }
  }

  private isWorkflowAlreadyTrackedError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes("already being tracked")
    );
  }

  private async ensureSessionWorkflowRunning(
    sessionId: string,
    spriteName: string,
    workflowId: string,
  ): Promise<void> {
    if (
      this.serverState.workflowInstanceId === workflowId &&
      this.getWorkflow(workflowId)
    ) {
      return;
    }

    try {
      await this.runWorkflow(
        SESSION_TURN_WORKFLOW_BINDING,
        {
          sessionId,
          spriteName,
        } satisfies SessionTurnWorkflowParams,
        {
          id: workflowId,
          agentBinding: "SESSION_AGENT",
        },
      );
    } catch (error) {
      if (!this.isWorkflowAlreadyTrackedError(error)) {
        throw error;
      }
    }

    this.updateServerState({ workflowInstanceId: workflowId });
  }

  private async sendTurnEventToWorkflow(
    workflowId: string,
    turnPayload: WorkflowTurnPayload,
  ): Promise<void> {
    await this.sendWorkflowEvent(
      SESSION_TURN_WORKFLOW_BINDING,
      workflowId,
      {
        type: WORKFLOW_MESSAGE_AVAILABLE_EVENT,
        payload: turnPayload,
      },
    );
  }

  private async recoverSessionWorkflowAfterSendFailure(
    workflowId: string,
  ): Promise<boolean> {
    try {
      const status = await this.getWorkflowStatus(
        SESSION_TURN_WORKFLOW_BINDING,
        workflowId,
      );

      switch (status.status) {
        case "complete":
        case "errored":
        case "terminated":
        case "unknown":
          await this.restartWorkflow(workflowId);
          this.updateServerState({ workflowInstanceId: workflowId });
          return true;
        case "queued":
        case "running":
        case "waiting":
        case "paused":
        case "waitingForPause":
          return false;
        default: {
          const exhaustiveCheck: never = status.status;
          throw new Error(
            `Unhandled workflow status during recovery: ${exhaustiveCheck}`,
          );
        }
      }
    } catch (statusError) {
      this.logger.warn("Failed to inspect or recover session workflow", {
        error: statusError,
        fields: { workflowId },
      });
      return false;
    }
  }

  private async cancelActiveWorkflowTurn(): Promise<void> {
    if (!this.serverState.activeWorkflowMessageId) {
      return;
    }

    const cancelSignalSent = await this.sendCancelSignalToActiveWorkflowTurn();
    if (cancelSignalSent) {
      return;
    }

    await this.stopWorkflowManagedProcesses();
  }

  private async sendCancelSignalToActiveWorkflowTurn(): Promise<boolean> {
    const spriteName = this.serverState.spriteName;
    const spriteExecSessionId = this.serverState.activeWorkflowExecSessionId;
    if (!spriteName || !spriteExecSessionId) {
      return false;
    }

    // attach to the session and send the cancel signal
    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    const session = sprite.attachSession(spriteExecSessionId, {
      idleTimeoutMs: 5_000,
    });

    try {
      await session.start();
      session.write(encodeAgentInput({ type: "cancel" }) + "\n");
      return true;
    } catch (error) {
      this.logger.warn("Failed to send workflow cancel signal via attachSession", {
        error,
        fields: { spriteExecSessionId },
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

  private async stopWorkflowManagedProcesses(): Promise<void> {
    const spriteName = this.serverState.spriteName;
    if (!spriteName) {
      return;
    }

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    const processId = this.serverState.activeWorkflowProcessId;
    try {
      if (processId) {
        await sprite.killSession(processId, "SIGTERM");
      }
    } catch (error) {
      // Session is already gone on the sprite — treat as successfully stopped
      // and clear the in-memory accumulator so no further chunks accumulate.
      if (error instanceof SpritesError && error.statusCode === 404) {
        this.logger.warn("Sprite session already gone; clearing accumulator", {
          fields: { processId },
        });
        this.messageAccumulator.reset();
        this.updateServerState({ activeWorkflowProcessId: null, activeWorkflowMessageId: null });
        return;
      }
      this.logger.error("Failed to stop workflow-managed processes", { error });
    }
  }

  // handle side effects of sending a user message
  private async onUserMessageSent(
    message: UIMessage,
    attachmentRecords: AttachmentRecord[],
    connectionId?: string,
  ): Promise<void> {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) return;
    const existing = this.messageRepository.getById(message.id);
    if (existing) {
      return;
    }
    const stored = this.messageRepository.create(sessionId, message);
    this.broadcastMessage(
      { type: "user.message", message: stored.message },
      connectionId ? [connectionId] : undefined,
    );
    // Sync to D1 history row and generate title
    const content = getUserMessageTextContent(message);
    const historyContent = this.toHistorySyncContent(
      content,
      attachmentRecords,
    );
    this.ctx.waitUntil(
      updateSessionHistoryData({
        database: this.env.DB,
        anthropicApiKey: this.env.ANTHROPIC_API_KEY,
        logger: this.logger,
        sessionId,
        messageContent: historyContent,
        messageRepository: this.messageRepository,
      }),
    );
  }

  private toHistorySyncContent(
    content: string | undefined,
    attachments: AttachmentRecord[],
  ): string {
    if (content) {
      return content;
    }
    if (attachments.length === 1) {
      return `Uploaded image: ${attachments[0]!.filename}`;
    }
    return `Uploaded ${attachments.length} images`;
  }

  // ============================================
  // GitHub token helpers
  // ============================================

  private gitProxyContext(): GitProxyContext {
    return {
      gitProxySecret: this.gitProxySecret,
      repoFullName: this.state.repoFullName,
      sessionId: this.serverState.sessionId,
      githubToken: this.githubToken,
      pushedBranch: this.state.pushedBranch,
      env: this.env,
      secretRepository: this.secretRepository,
    };
  }

  private async refreshGitHubToken(): Promise<void> {
    const token = await ensureValidInstallationToken(this.gitProxyContext());
    if (token) {
      this.githubToken = token;
    }
  }

  private async assertSessionRepoAccess(): Promise<SessionRepoAccessResult> {
    const sessionId = this.serverState.sessionId;
    const userId = this.serverState.userId;
    if (!sessionId || !userId) {
      return {
        ok: false as const,
        error: {
          code: "SESSION_NOT_FOUND" as const,
          status: 404 as const,
          message: "Session not found",
        },
      };
    }

    return assertSessionRepoAccess({
      env: this.env,
      sessionId,
      userId,
    });
  }

  private async guardSessionRepoAccess(connection: Connection): Promise<boolean> {
    const accessResult = await this.assertSessionRepoAccess();
    if (accessResult.ok) {
      return true;
    }

    switch (accessResult.error.code) {
      case "REPO_ACCESS_BLOCKED":
        await this.enforceSessionAccessBlocked(false);
        this.sendMessage(
          {
            type: "operation.error",
            code: "REPO_ACCESS_BLOCKED",
            message: accessResult.error.message,
          },
          connection,
        );
        return false;
      case "GITHUB_AUTH_REQUIRED":
        this.sendMessage(
          {
            type: "operation.error",
            code: "GITHUB_AUTH_REQUIRED",
            message: accessResult.error.message,
          },
          connection,
        );
        return false;
      default:
        this.sendMessage(
          {
            type: "operation.error",
            code: "MESSAGE_HANDLER_ERROR",
            message: accessResult.error.message,
          },
          connection,
        );
        return false;
    }
  }

  async enforceSessionAccessBlocked(
    notifyClients = true,
  ): Promise<void> {
    this.updatePartialState({
      lastError: "Repository access for this session is currently blocked.",
    });
    await this.cancelActiveWorkflowTurn();
    await this.stopWorkflowManagedProcesses();
    if (notifyClients) {
      this.broadcastMessage({
        type: "operation.error",
        code: "REPO_ACCESS_BLOCKED",
        message: "Repository access for this session is currently blocked.",
      });
    }
  }

  // ============================================
  // Broadcast / send helpers
  // ============================================

  private broadcastMessage(message: ServerMessage, without?: string[]): void {
    this.broadcast(JSON.stringify(message), without);
  }

  private sendMessage(message: ServerMessage, to: Connection): void {
    to.send(JSON.stringify(message));
  }
}
