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
const DEFAULT_BATCH_MAX_AGE_MS = 100;

export class WebhookAgentRunner<S extends AgentSettings = AgentSettings> {
  private readonly harness: AgentHarnessHandle;
  private readonly batcher: ChunkBatcher;
  private readonly http: WebhookClient;
  private readonly idleTimeoutMs: number;
  private readonly onShutdown: () => void;
  private readonly log: NonNullable<WebhookAgentRunnerOptions["logger"]>;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private activeUserMessageId: string | null = null;
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
      onTurnStart: () => this.cancelIdleTimer(),
      onTurnEnd: (result) => void this.onTurnEnd(result),
    });
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
    this.activeUserMessageId = userMessageId;
    this.harness.queueMessage(message, overrides);
  }

  cancel(): void {
    this.harness.cancel();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.cancelIdleTimer();
    await this.batcher.flushNow();
    await this.harness.shutdown();
    this.onShutdown();
  }

  private handleEmit(output: AgentOutput): void {
    if (output.type === "stream") {
      this.batcher.add(output.chunk as UIMessageChunk);
      return;
    }
    this.log("debug", "emit event -> /events", { ...output });
    // Process-level events go straight to /events, one POST per event.
    // Fire-and-forget — the WebhookClient handles retries internally.
    void this.http.post("/events", { event: output });
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

  private async onTurnEnd(_result: AgentTurnEndResult): Promise<void> {
    // The DO learns about turn completion from the terminal stream chunk
    // inside the last batch — we just flush and arm the idle timer here.
    await this.batcher.flushNow();
    this.activeUserMessageId = null;
    this.startIdleTimer();
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
