import {
  type AgentEvent,
  type ClientState,
  type Logger,
  type ServerMessage,
  type SessionStatus,
} from "@repo/shared";
import type { Env } from "@/types";
import type { UIMessageChunk } from "ai";
import { MessageAccumulator } from "@repo/shared";
import { createLogger } from "@/lib/logger";
import { applyDerivedStateFromParts } from "../session-agent-derived-state";
import type { MessageRepository } from "../repositories/message-repository";
import type { PendingChunkRepository } from "../repositories/pending-chunk-repository";
import type { LatestPlanRepository } from "../repositories/latest-plan-repository";
import type { ServerState } from "../repositories/server-state-repository";
import { SpritesError, WorkersSpriteClient } from "@/lib/sprites";

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
  }

  /**
   * Rehydrates the in-memory accumulator from the WAL at most once per DO
   * instance. If an active turn is marked but the sprite process is gone,
   * commits the partial as aborted in the background.
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
          activeUserMessageId: serverState.activeUserMessageId,
        },
      });
      // backfill any plans or todos that were missed
      let lastTodos: ClientState["todos"] | null | undefined;
      let lastPlan: ClientState["plan"] | null | undefined;
      for (const chunk of orphanedChunks) {
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
    }

    this.hasEnsuredRehydratedState = true;

    // TODO: im not sure that 
    if (serverState.activeUserMessageId) {
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
   * Records that a new turn has started for `userMessageId`, backed by the
   * given sprite process. Called by SessionChatDispatchService right before
   * the vm-agent process is spawned, so the webhook handler can validate
   * inbound payloads against it.
   */
  beginTurn(userMessageId: string, agentProcessId: number | null): void {
    this.updateServerState({
      activeUserMessageId: userMessageId,
      agentProcessId,
    });
    this.updatePartialState({
      lastError: null,
      status: this.synthesizeStatus(),
    });
  }

  /**
   * Handles a batch of streamed chunks from the vm-agent webhook. Accumulates,
   * persists to WAL, broadcasts, and finalizes the turn if a terminal chunk
   * is present.
   */
  handleChunks(
    userMessageId: string,
    chunks: Array<{ sequence: number; chunk: UIMessageChunk }>,
  ): void {
    this.ensureRehydratedState();
    if (this.isStaleRpc(userMessageId)) return;
    this.logger.debug(`handling ${chunks.length} chunks for message ${userMessageId}`);

    for (const { sequence, chunk } of chunks) {
      void sequence; // carried for ordering/debugging; not used locally
      this.handleStreamChunk(chunk);

      if (isTerminalChunk(chunk)) {
        this.logger.info("Terminal chunk received", {
          fields: {
            userMessageId,
            finishReason: getChunkFinishReason(chunk) ?? "unknown",
          },
        });
        this.clearActiveTurnState();
        this.updatePartialState({
          lastError: null,
          status: this.synthesizeStatus(),
        });
      }
    }
  }

  /**
   * Dispatches an AgentEvent from the /events webhook into the right
   * side-effect: persist provider session id, surface errors, etc.
   */
  handleEvent(event: AgentEvent): void {
    this.ensureRehydratedState();
    const serverState = this.getServerState();
    switch (event.type) {
      case "ready":
        this.updatePartialState({ status: this.synthesizeStatus() });
        break;
      case "error":
        this.logger.error(`vm-agent error: ${event.error}`);
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
      case "sessionId":
        this.logger.info(`Storing agent session ID: ${event.sessionId}`);
        if (
          serverState.agentSessionId &&
          serverState.agentSessionId !== event.sessionId
        ) {
          this.logger.warn(
            `Agent session ID mismatch: ${serverState.agentSessionId} !== ${event.sessionId}`,
          );
        }
        this.updateServerState({ agentSessionId: event.sessionId });
        break;
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
    if (this.isStaleRpc(userMessageId)) return;
    this.logger.error("Turn spawn failed", {
      fields: { userMessageId },
      error: errorMessage,
    });
    const saved = this.commitAbortedMessage();
    if (saved) {
      this.logger.info("Committed partial message on spawn failure");
    }
    this.messageAccumulator.reset();
    this.clearActiveTurnState();
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

  /**
   * Best-effort: if the sprite process for the active turn no longer exists,
   * commit the partial message as aborted. Pre-existing webhooks will still
   * be accepted if the process is alive.
   */
  private async reconcileActiveTurn(): Promise<void> {
    const serverState = this.getServerState();
    const { agentProcessId, spriteName } = serverState;
    if (!agentProcessId || !spriteName) return;

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
        this.messageAccumulator.reset();
        this.clearActiveTurnState();
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

  private handleStreamChunk(chunk: UIMessageChunk): void {
    const serverState = this.getServerState();
    this.broadcastMessage({ type: "agent.chunk", chunk });
    this.pendingChunkRepository.append(chunk);

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
      const stored = this.messageRepository.create(
        serverState.sessionId!,
        finishedMessage,
      );
      this.pendingChunkRepository.clear();
      this.broadcastMessage({ type: "agent.finish", message: stored.message });
      this.messageAccumulator.reset();
    }
  }

  /**
   * Aborts the in-memory accumulator, flushes the WAL, persists whatever is
   * there, and broadcasts agent.finish. Returns true if a message was saved.
   */
  private commitAbortedMessage(): boolean {
    const message = this.messageAccumulator.forceAbort();
    this.pendingChunkRepository.clear();
    if (!message) return false;
    const sessionId = this.getServerState().sessionId!;
    const stored = this.messageRepository.create(sessionId, message);
    this.broadcastMessage({ type: "agent.finish", message: stored.message });
    return true;
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

  private clearActiveTurnState(): void {
    this.updateServerState({
      activeUserMessageId: null,
      agentProcessId: null,
    });
  }
}

function isTerminalChunk(chunk: UIMessageChunk): boolean {
  switch (chunk.type) {
    case "finish":
    case "abort":
      return true;
    default:
      return false;
  }
}

function getChunkFinishReason(chunk: UIMessageChunk): string | undefined {
  const finishReason = (chunk as { finishReason?: unknown }).finishReason;
  return typeof finishReason === "string" ? finishReason : undefined;
}
