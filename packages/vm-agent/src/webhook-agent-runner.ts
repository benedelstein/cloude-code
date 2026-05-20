/**
 * Drives the agent harness with webhook-based delivery. Stream chunks go
 * through the ChunkBatcher and land on POST /chunks; every other output
 * (sessionId, ready, heartbeat, error, debug) goes on POST /events, one
 * event per request.
 */
import {
  type AgentInputMessage,
  type AgentMode,
  type AgentOutput,
  type AgentSettings,
  type UIMessageChunk,
  encodeAgentOutput,
} from "@repo/shared";
import {
  type AgentHarnessHandle,
  type AgentProviderConfig,
  type AgentTurnEndResult,
  startAgentHarness,
} from "./lib/agent-harness";
import { ChunkBatcher, type ChunkBatchItem } from "./lib/chunk-batcher";
import { WebhookClient } from "./lib/webhook-client";

export interface WebhookAgentRunnerOptions<S extends AgentSettings = AgentSettings> {
  config: AgentProviderConfig<S>;
  settings: S;
  webhookUrl: string;
  webhookToken: string;
  args?: { sessionId?: string };
  initialAgentMode?: AgentMode;
  idleTimeoutMs?: number;
  batchMaxChunks?: number;
  batchMaxAgeMs?: number;
  /** Hook for runner shutdown — defaults to process.exit(0). */
  onShutdown?: () => void;
  logger?: (_level: "debug" | "warn", _message: string, _meta?: unknown) => void;
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_BATCH_MAX_CHUNKS = 50;
const DEFAULT_BATCH_MAX_AGE_MS = 300;
/** Hard cap on shutdown draining so a wedged webhook retry can't block exit. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;
const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

export class WebhookAgentRunner<S extends AgentSettings = AgentSettings> {
  private readonly harness: AgentHarnessHandle;
  private readonly batcher: ChunkBatcher;
  private readonly http: WebhookClient;
  private readonly idleTimeoutMs: number;
  private readonly onShutdown: () => void;
  private readonly log: NonNullable<WebhookAgentRunnerOptions["logger"]>;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private activeUserMessageId: string | null = null;
  private readonly userMessageIds = new WeakMap<AgentInputMessage, string>();
  private shuttingDown = false;

  constructor(private readonly opts: WebhookAgentRunnerOptions<S>) {
    this.idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.onShutdown = opts.onShutdown ?? (() => process.exit(0));
    this.log = opts.logger ?? (() => {});

    this.http = new WebhookClient(opts.webhookUrl, opts.webhookToken, {
      logger: this.log,
    });

    this.batcher = new ChunkBatcher({
      maxChunks: opts.batchMaxChunks ?? DEFAULT_BATCH_MAX_CHUNKS,
      maxAgeMs: opts.batchMaxAgeMs ?? DEFAULT_BATCH_MAX_AGE_MS,
      flush: (batch) => this.flushChunkBatch(batch),
    });

    this.harness = startAgentHarness({
      config: opts.config,
      settings: opts.settings,
      args: opts.args,
      initialAgentMode: opts.initialAgentMode,
      emit: (output) => this.handleEmit(output),
      onTurnStart: (message) => this.onTurnStart(message),
      onTurnEnd: (result) => this.onTurnEnd(result),
    });

    this.installSignalHandlers();
  }

  /**
   * Queues a user turn and tags outbound chunks with the given userMessageId.
   */
  queueMessage(
    userMessageId: string,
    message: AgentInputMessage,
    overrides?: { model?: string; agentMode?: AgentMode },
  ): void {
    this.cancelIdleTimer();
    this.userMessageIds.set(message, userMessageId);
    this.harness.queueMessage(message, overrides, userMessageId);
  }

  /**
   * Queues a user turn from stdin and emits a typed ack once accepted.
   */
  queueStdinMessage(
    userMessageId: string,
    message: AgentInputMessage,
    overrides?: { model?: string; agentMode?: AgentMode },
  ): void {
    this.queueMessage(userMessageId, message, overrides);
    this.handleEmit({ type: "stdin_ack", userMessageId });
  }

  cancelTurn(userMessageId: string): void {
    const canceled = this.harness.cancelTurn(userMessageId);
    if (canceled) {
      this.handleEmit({ type: "cancel_ack", userMessageId });
    }
  }

  /**
   * Cancels the in-flight turn (if any), waits for the harness to drain its
   * abort terminal chunk through the batcher, then exits. Bounded by
   * `SHUTDOWN_DRAIN_TIMEOUT_MS` so a stuck webhook retry can't block exit.
   *
   * Used by both the idle timer and the SIGTERM/SIGINT handlers — the cancel
   * step is a no-op when no turn is active.
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.cancelIdleTimer();

    // Aborting the current streamText causes the harness to emit a terminal
    // abort chunk into the batcher (forcing a flush), so the DO finalizes
    // the turn through the normal terminal-chunk path.
    this.harness.cancelTurn();

    const drain = (async () => {
      await this.harness.shutdown();
      await this.batcher.flushNow();
    })();
    const deadline = new Promise<void>((resolve) => {
      setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
    });
    await Promise.race([drain, deadline]);

    this.onShutdown();
  }

  private handleEmit(output: AgentOutput): void {
    switch (output.type) {
      case "stream":
        this.batcher.add(output.chunk as UIMessageChunk);
        return;
      case "stdin_ack":
      case "cancel_ack":
        // write directly to stdout so caller can synchronously await the ack
        // (via websocket)
        process.stdout.write(encodeAgentOutput(output) + "\n");
        return;
      case "ready":
      case "debug":
      case "error":
      case "sessionId":
      case "heartbeat":
        this.log("debug", "emit event -> /events", { ...output });
        // Process-level events go straight to /events, one POST per event.
        // Fire-and-forget — the WebhookClient handles retries internally.
        void this.http.post("/events", { event: output });
        return;
      default: {
        const exhaustiveCheck: never = output;
        throw new Error(`Unhandled agent output: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private async flushChunkBatch(batch: ChunkBatchItem[]): Promise<void> {
    const userMessageId = this.activeUserMessageId;
    if (!userMessageId) {
      this.log("warn", "dropping chunk batch with no active userMessageId", {
        size: batch.length,
      });
      return;
    }
    this.log("debug", "flushing chunk batch -> /chunks", {
      userMessageId,
      size: batch.length,
      firstSeq: batch[0]?.sequence,
      lastSeq: batch[batch.length - 1]?.sequence,
    });
    await this.http.post("/chunks", { userMessageId, chunks: batch });
  }

  private onTurnStart(message: AgentInputMessage): void {
    this.cancelIdleTimer();
    const userMessageId = this.userMessageIds.get(message);
    this.userMessageIds.delete(message);
    if (!userMessageId) {
      this.log("warn", "turn started without queued userMessageId");
      this.activeUserMessageId = null;
      return;
    }
    this.activeUserMessageId = userMessageId;
  }

  private async onTurnEnd(_result: AgentTurnEndResult): Promise<void> {
    const endedUserMessageId = this.activeUserMessageId;
    // The DO learns about turn completion from the terminal stream chunk
    // inside the last batch — we just flush and arm the idle timer here.
    await this.batcher.flushNow();
    // Reset the per-process sequence counter so the next turn (if a future
    // long-lived runner reuses this process) starts at seq 0, matching the
    // DO's first-chunk expectation.
    this.batcher.reset();
    if (this.activeUserMessageId === endedUserMessageId) {
      this.activeUserMessageId = null;
    }
    if (!this.shuttingDown) this.startIdleTimer();
  }

  private installSignalHandlers(): void {
    for (const signal of SHUTDOWN_SIGNALS) {
      process.on(signal, () => {
        this.log("warn", `received ${signal}, draining and exiting`);
        void this.shutdown();
      });
    }
  }

  private startIdleTimer(): void {
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => {
      void this.shutdown();
    }, this.idleTimeoutMs);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
