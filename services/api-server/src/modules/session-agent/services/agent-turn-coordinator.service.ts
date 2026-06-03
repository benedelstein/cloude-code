import type {
  AgentEvent,
  ClientState,
  Logger,
  ServerMessage,
  SessionStatus,
  SessionWorkingState,
} from "@repo/shared";
import type { Env } from "@/shared/types";
import type { UIMessage, UIMessageChunk } from "ai";
import { MessageAccumulator } from "@repo/shared";
import { createLogger } from "@/shared/logging";
import { applyDerivedStateFromParts } from "./session-agent-derived-state.service";
import type { MessageRepository } from "../repositories/message.repository";
import type { PendingChunkRepository } from "../repositories/pending-chunk.repository";
import type { LatestPlanRepository } from "../repositories/latest-plan.repository";
import type { ServerState } from "../repositories/server-state.repository";
import { SpritesError } from "@/shared/integrations/sprites/types";
import { WorkersSpriteClient } from "@/shared/integrations/sprites/WorkersSpriteClient";

/**
 * Dependencies injected from the SessionAgentDO into the coordinator.
 * Keeps coupling explicit and avoids a circular type reference to the DO class.
 */
export interface AgentTurnCoordinatorDeps {
  logger: Logger;
  env: Env;

  messageRepository: MessageRepository;
  pendingChunkRepository: PendingChunkRepository;
  latestPlanRepository: LatestPlanRepository;

  getServerState: () => ServerState;
  updateServerState: (partial: Partial<ServerState>) => void;
  getClientState: () => ClientState;
  updatePartialState: (partial: Partial<ClientState>) => void;
  broadcastMessage: (message: ServerMessage) => void;
  synthesizeStatus: () => SessionStatus;
  terminateActiveProcess: () => Promise<void>;
  updateWorkingState: (state: SessionWorkingState) => void;
  setupReporter?: {
    completeTask(taskId: "initial_agent_start"): void;
    failTask(taskId: "initial_agent_start", error: string): void;
  };
}

/**
 * Owns turn lifecycle and chunk accumulation for a session. Inbound chunks
 * and events arrive via the webhook routes; this coordinator applies them
 * to the in-memory accumulator, persists to the WAL, broadcasts to clients,
 * and clears active-turn state on terminal chunks.
 *
 * It does not talk to the sprite directly — SpriteAgentProcessManager owns
 * the process lifecycle (spawn / cancel / kill).
 */
export class AgentTurnCoordinator {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly messageRepository: MessageRepository;
  private readonly pendingChunkRepository: PendingChunkRepository;
  private readonly latestPlanRepository: LatestPlanRepository;
  private readonly getServerState: () => ServerState;
  private readonly updateServerState: AgentTurnCoordinatorDeps["updateServerState"];
  private readonly getClientState: () => ClientState;
  private readonly updatePartialState: (partial: Partial<ClientState>) => void;
  private readonly broadcastMessage: (message: ServerMessage) => void;
  private readonly synthesizeStatus: () => SessionStatus;
  private readonly terminateActiveProcess: () => Promise<void>;
  private readonly updateWorkingState: (state: SessionWorkingState) => void;
  private readonly setupReporter: AgentTurnCoordinatorDeps["setupReporter"];
  /**
   * The highest chunk sequence applied within the active turn. `null` means
   * no chunks have been applied yet (fresh turn or post-clear). Lazily set
   * on first chunk arrival, or rehydrated from `MAX(WAL.sequence)` after a
   * DO restart that picked up an in-flight turn. Reset to `null` whenever
   * the turn ends.
   *
   * Used only for gap detection — duplicate detection lives in the WAL via
   * the UNIQUE sequence column. Relies on `ChunkBatcher` serializing flushes;
   * if that ever changes, this scheme must be revisited.
   */
  private lastSeenChunkSequence: number | null = null;

  private hasEnsuredRehydratedState = false;
  private messageAccumulator = new MessageAccumulator(createLogger("MessageAccumulator"));

  constructor(deps: AgentTurnCoordinatorDeps) {
    this.logger = deps.logger.scope("agent-turn-coordinator");
    this.env = deps.env;
    this.messageRepository = deps.messageRepository;
    this.pendingChunkRepository = deps.pendingChunkRepository;
    this.latestPlanRepository = deps.latestPlanRepository;
    this.getServerState = deps.getServerState;
    this.updateServerState = deps.updateServerState;
    this.getClientState = deps.getClientState;
    this.updatePartialState = deps.updatePartialState;
    this.broadcastMessage = deps.broadcastMessage;
    this.synthesizeStatus = deps.synthesizeStatus;
    this.terminateActiveProcess = deps.terminateActiveProcess;
    this.updateWorkingState = deps.updateWorkingState;
    this.setupReporter = deps.setupReporter;
  }

  /**
   * Rehydrates the in-memory accumulator from the WAL at most once per DO
   * instance. If an active turn is marked but the sprite process is gone,
   * commits the partial as aborted in the background.
   */
  ensureRehydratedState(): void {
    if (this.hasEnsuredRehydratedState) { return; }
    const serverState = this.getServerState();
    const sessionId = serverState.sessionId;
    if (!sessionId) { return; }

    const orphanedChunks = this.pendingChunkRepository.getAll();
    if (orphanedChunks.length > 0) {
      this.logger.info("Rehydrating message accumulator from WAL on DO restart", {
        fields: {
          chunkCount: orphanedChunks.length,
          activeUserMessageId: serverState.activeUserMessageId,
        },
      });
      // backfill any plans or todos that were missed
      let lastTodos: ClientState["todos"] | null | undefined;
      let lastPlan: ClientState["plan"] | null | undefined;
      for (const { chunk } of orphanedChunks) {
        const { completedParts } = this.messageAccumulator.process(chunk);
        applyDerivedStateFromParts(
          {
            sessionId,
            latestPlanRepository: this.latestPlanRepository,
            updatePartialState: (partial) => {
              lastTodos = partial.todos;
              lastPlan = partial.plan;
              this.updatePartialState(partial);
            },
          },
          completedParts,
          this.messageAccumulator.getMessageId(),
        );
      }
      if (lastTodos !== undefined) {
        this.updatePartialState({ todos: lastTodos });
      }
      if (lastPlan !== undefined) {
        this.updatePartialState({ plan: lastPlan });
      }
      // WAL is sorted ascending; last seen = highest sequence in the WAL.
      this.lastSeenChunkSequence = orphanedChunks[orphanedChunks.length - 1]!.sequence;
    }

    this.hasEnsuredRehydratedState = true;

    if (serverState.activeUserMessageId) {
      // if active user message id, then ... ?
      this.logger.info("Reconciling active turn on DO restart");
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
   * Marks `userMessageId` as the active turn before the sprite process is
   * spawned so any webhook racing in with chunks correlates correctly.
   * `agentProcessId` is filled in later via `attachProcessId` once the spawn
   * returns.
   */
  beginTurn(userMessageId: string): void {
    this.updateServerState({
      activeUserMessageId: userMessageId,
    });
    this.updateWorkingState("responding");
    this.updatePartialState({
      activeTurn: { userMessageId },
      lastError: null,
      status: this.synthesizeStatus(),
    });
  }

  /**
   * Records the sprite exec process id for the active turn so cancel/kill
   * paths can target it. Called immediately after a successful spawn.
   */
  attachProcessId(agentProcessId: number): void {
    this.updateServerState({ agentProcessId });
  }

  /**
   * Handles a batch of streamed chunks from the vm-agent webhook. Accumulates,
   * persists to WAL, broadcasts, and finalizes the turn if a terminal chunk
   * is present.
   */
  async handleChunks(
    userMessageId: string,
    chunks: Array<{ sequence: number; chunk: UIMessageChunk }>,
  ): Promise<void> {
    this.ensureRehydratedState();
    if (this.isStaleRpc(userMessageId)) { return; }
    if (this.getServerState().activeUserMessageId === null) {
      // No active turn (clean finish, abort, or gap already cleared state).
      // Drop late chunks silently so retries of a terminated batch can't
      // restart accumulation against cleared state.
      this.logger.debug("Ignoring chunks with no active turn", {
        fields: { chunkCount: chunks.length, userMessageId },
      });
      return;
    }

    // Buffer freshly-inserted chunks and emit one agent.chunks broadcast per
    // batch (or per exit point). Each ws emit fans out to every attached client,
    // so collapsing N → 1 is meaningfully cheaper.
    const buffered: UIMessageChunk[] = [];
    for (const { sequence, chunk } of chunks) {
      // Gap check skipped for the very first chunk (lastSeen is null) — the
      // vm-agent's ChunkBatcher always starts a turn at 0
      if (this.lastSeenChunkSequence !== null) {
        const expected = this.lastSeenChunkSequence + 1;
        if (sequence > expected) {
          this.logger.error("Chunk stream gap", {
            fields: { userMessageId, expected, sequence },
          });
          this.flushBufferedChunks(buffered);
          await this.handleStreamGap(expected, sequence);
          return;
        }
        if (sequence < expected) {
          // WAL unique check should catch this so fall through
          this.logger.warn("Chunk is lower than expected", {
            fields: { expected, sequence },
          });
        }
      } else {
        if (sequence !== 0) {
          this.logger.warn("Nonzero first chunk received", {
            fields: { sequence },
          });
        }
      }
      // WAL is the source of truth for dedup: a UNIQUE conflict on `sequence`
      // means this chunk was already applied by a prior batch (retry).
      const inserted = this.pendingChunkRepository.appendIfNew(chunk, sequence);
      if (!inserted) {
        this.logger.warn("Dropping duplicate chunk from WAL conflict", {
          fields: { sequence },
        });
        continue;
      }
      buffered.push(chunk);
      const result = this.handleStreamChunk(chunk);
      if (result.ended) {
        // Flush the batched chunks (including this terminal one) before the
        // agent.finish so the wire order stays chunks → finish.
        this.flushBufferedChunks(buffered);
        this.broadcastMessage({ type: "agent.finish", message: result.finishMessage });
        return;
      }
      this.lastSeenChunkSequence = sequence;
    }
    this.flushBufferedChunks(buffered);
  }

  /**
   * Dispatches an AgentEvent from the /events webhook into the right
   * side-effect: persist provider session id, surface errors, etc.
   */
  handleEvent(event: AgentEvent): void {
    this.ensureRehydratedState();
    switch (event.type) {
      case "ready":
        if (this.isInitialAgentStartRunning()) {
          this.setupReporter?.completeTask("initial_agent_start");
        }
        this.updatePartialState({ status: this.synthesizeStatus() });
        break;
      case "error":
        this.logger.error("vm-agent error", {
          fields: { errorMessage: event.error },
        });
        if (this.isInitialAgentStartRunning()) {
          this.setupReporter?.failTask("initial_agent_start", event.error);
        }
        this.messageAccumulator.reset();
        this.pendingChunkRepository.clear();
        this.clearActiveTurnState();
        this.updatePartialState({
          lastError: event.error,
          status: this.synthesizeStatus(),
        });
        this.broadcastMessage({
          type: "operation.error",
          code: "CHAT_MESSAGE_FAILED",
          message: event.error,
        });
        break;
      case "sessionId": {
        const serverState = this.getServerState();
        this.logger.info("Storing agent session ID", {
          fields: { agentSessionId: event.sessionId },
        });
        if (
          serverState.agentSessionId &&
          serverState.agentSessionId !== event.sessionId
        ) {
          this.logger.warn("Agent session ID mismatch", {
            fields: {
              currentAgentSessionId: serverState.agentSessionId,
              incomingAgentSessionId: event.sessionId,
            },
          });
        }
        this.updateServerState({ agentSessionId: event.sessionId });
        break;
      }
      case "heartbeat":
      case "debug":
        break;
    }
  }

  /**
   * Called by SessionChatDispatchService when the process manager fails to
   * spawn a turn. Marks the user message aborted and surfaces the error.
   */
  handleTurnSpawnFailed(userMessageId: string, errorMessage: string): void {
    if (this.isStaleRpc(userMessageId)) { return; }
    this.logger.error("Turn spawn failed", {
      fields: { userMessageId },
      error: errorMessage,
    });
    const saved = this.commitAbortedMessage();
    if (saved) {
      this.logger.info("Committed partial message on spawn failure");
    }
    this.updatePartialState({
      lastError: errorMessage,
      status: this.synthesizeStatus(),
    });
    this.broadcastMessage({
      type: "operation.error",
      code: "CHAT_MESSAGE_FAILED",
      message: errorMessage,
    });
  }

  // ============================================
  // Private
  // ============================================

  private isInitialAgentStartRunning(): boolean {
    return this.getClientState().sessionSetupRun?.tasks.some((task) =>
      task.id === "initial_agent_start" && task.status === "running",
    ) ?? false;
  }

  /**
   * Best-effort: if the sprite process for the active turn no longer exists,
   * commit the partial message as aborted. Pre-existing webhooks will still
   * be accepted if the process is alive.
   */
  private async reconcileActiveTurn(): Promise<void> {
    const serverState = this.getServerState();
    const { agentProcessId, spriteName } = serverState;
    if (!agentProcessId || !spriteName) { return; }

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );
    const session = sprite.attachSession(String(agentProcessId), {
      idleTimeoutMs: 3_000,
    });
    try {
      await session.start();
      // Process is still alive; webhooks will drive it to completion.
      this.logger.info("Reconcile: active sprite process is still alive");
    } catch (error) {
      if (error instanceof SpritesError && error.statusCode === 404) {
        this.logger.warn(
          "Reconcile: sprite process is gone; committing partial as aborted",
        );
        this.commitAbortedMessage();
        this.updatePartialState({ status: this.synthesizeStatus() });
        return;
      }
      this.logger.warn("Reconcile: attach failed, leaving active turn as-is", {
        error,
      });
    } finally {
      try {
        session.close();
      } catch (error) {
        this.logger.debug("Reconcile: failed to close attach session", { error });
      }
    }
  }

  /**
   * Applies a single fresh chunk: feeds the accumulator and, if the chunk was
   * terminal, persists the finished message and clears turn state. Does NOT
   * broadcast — the caller handles batched broadcasting so chunk and finish
   * events keep their wire order (chunks → finish).
   *
   * @returns When the chunk is non-terminal: `{ ended: false }`. When the
   *   chunk is terminal: `{ ended: true, finishMessage }` with the persisted
   *   UIMessage that the caller should broadcast as `agent.finish`.
   */
  private handleStreamChunk(
    chunk: UIMessageChunk,
  ): { ended: false } | { ended: true; finishMessage: UIMessage } {
    const serverState = this.getServerState();

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

    if (!finishedMessage) { return { ended: false }; }

    this.logger.debug("Finished message", {
      fields: { messageId: finishedMessage.id },
    });
    const stored = this.messageRepository.create(
      serverState.sessionId!,
      finishedMessage,
    );
    this.pendingChunkRepository.clear();
    this.messageAccumulator.reset();
    this.logger.info("Terminal chunk received", {
      fields: {
        userMessageId: serverState.activeUserMessageId,
        finishReason: getChunkFinishReason(chunk) ?? "unknown",
      },
    });
    this.clearActiveTurnState({ preserveAgentProcessId: true });
    this.updatePartialState({
      lastError: null,
      status: this.synthesizeStatus(),
    });
    return { ended: true, finishMessage: stored.message };
  }

  /** Emits buffered chunks as a single agent.chunks */
  private flushBufferedChunks(buffered: UIMessageChunk[]): void {
    if (buffered.length === 0) { return; }
    this.broadcastMessage({ type: "agent.chunks", chunks: buffered });
  }

  /**
   * Aborts the in-memory accumulator, flushes the WAL, persists whatever is
   * there, and broadcasts agent.finish. Always clears active turn state so
   * the session can accept a new message.
   *
   * @returns true if a partial message was saved.
   */
  private commitAbortedMessage(
    options: { preserveAgentProcessId?: boolean } = {},
  ): boolean {
    const abortedMessage = this.messageAccumulator.forceAbort();
    this.pendingChunkRepository.clear();
    if (abortedMessage) {
      const sessionId = this.getServerState().sessionId!;
      const stored = this.messageRepository.create(sessionId, abortedMessage);
      this.broadcastMessage({ type: "agent.finish", message: stored.message });
      this.messageAccumulator.reset();
    }
    this.clearActiveTurnState(options);
    return !!abortedMessage;
  }

  /**
   * Public cancel hook for callers that have already torn down the agent
   * process out-of-band (e.g. SIGTERM with no terminal chunk arriving, or a
   * 404 from killSession). Persists any accumulated partial as aborted and
   * clears active turn state so the user can send a new message.
   */
  markTurnCanceled(
    options: { preserveAgentProcessId?: boolean } = {},
  ): void {
    if (!this.getServerState().activeUserMessageId) { return; }
    this.commitAbortedMessage(options);
    this.updatePartialState({ status: this.synthesizeStatus() });
  }

  /**
   * Ignores webhook payloads for a messageId that does not match the current
   * active turn. Permissive when active is null so a terminal chunk that
   * lands right after reconcile cleared state still flows through.
   */
  private isStaleRpc(userMessageId: string): boolean {
    const activeUserMessageId = this.getServerState().activeUserMessageId;
    if (activeUserMessageId && activeUserMessageId !== userMessageId) {
      this.logger.warn("Ignoring webhook for non-active message", {
        fields: { incomingMessageId: userMessageId, activeUserMessageId },
      });
      return true;
    }
    return false;
  }

  private clearActiveTurnState(
    options: { preserveAgentProcessId?: boolean } = {},
  ): void {
    this.updateServerState({
      activeUserMessageId: null,
      agentProcessId: options.preserveAgentProcessId
        ? this.getServerState().agentProcessId
        : null,
    });
    this.updatePartialState({ activeTurn: null });
    this.updateWorkingState("idle");
    this.lastSeenChunkSequence = null;
  }

  /**
   * Aborts the active turn after a chunk stream gap (a missing sequence id
   * that the sender will never re-deliver). Commits whatever was streamed so
   * far, surfaces an error to the client, and clears state so subsequent
   * retried batches for the dead turn are dropped by the no-active guard.
   */
  private async handleStreamGap(expected: number, received: number): Promise<void> {
    this.commitAbortedMessage({ preserveAgentProcessId: true });
    this.updatePartialState({
      lastError: `Chunk stream gap: expected ${expected}, received ${received}`,
      status: this.synthesizeStatus(),
    });
    this.broadcastMessage({
      type: "operation.error",
      code: "CHAT_MESSAGE_FAILED",
      message: "Streaming error: missing chunks; turn aborted",
    });

    await this.terminateActiveProcess();
  }
}

function getChunkFinishReason(chunk: UIMessageChunk): string | undefined {
  const finishReason = (chunk as { finishReason?: unknown }).finishReason;
  return typeof finishReason === "string" ? finishReason : undefined;
}
