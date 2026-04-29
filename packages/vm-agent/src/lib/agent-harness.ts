/**
 * Shared agent harness. Owns provider setup, the message queue, and the
 * streamText processing loop — but NOT its edges. Input/output and lifecycle
 * hooks are injected by the caller, so the same harness drives the legacy
 * stdio runner and the new webhook runner.
 */
import {
  type LanguageModel,
  StreamTextOnErrorCallback,
  type StreamTextOnStepFinishCallback,
  type ToolSet,
  type UserContent,
  streamText,
} from "ai";
import { readFileSync } from "fs";
import {
  type AgentMode,
  type AgentInputMessage,
  type AgentOutput,
  type AgentSettings,
} from "@repo/shared";

export interface ProviderSetupContext<S extends AgentSettings = AgentSettings> {
  emit: (_output: AgentOutput) => void;
  settings: S;
  agentMode: AgentMode;
  sessionSuffix: string;
  args: { sessionId?: string };
  spriteContext: string;
}

export type StreamTextExtras = {
  providerOptions?: Parameters<typeof streamText>[0]["providerOptions"];
  onStepFinish?: StreamTextOnStepFinishCallback<ToolSet>;
  onError?: StreamTextOnErrorCallback;
};

export type GetModelOptions = {
  agentMode: AgentMode;
};

export interface SetupResult<ModelId extends string = AgentSettings["model"]> {
  modelId: ModelId;
  getModel: (_modelId: ModelId, _options: GetModelOptions) => LanguageModel;
  getStreamTextExtras?: () => StreamTextExtras;
  cleanup?: () => Promise<void>;
}

export interface AgentProviderConfig<S extends AgentSettings = AgentSettings> {
  setup(_context: ProviderSetupContext<S>): Promise<SetupResult<S["model"]>>;
}

export interface AgentTurnEndResult {
  finishReason?: string;
  aborted: boolean;
}

export interface AgentHarnessOptions<S extends AgentSettings = AgentSettings> {
  config: AgentProviderConfig<S>;
  settings: S;
  /** Called for every output the harness produces. */
  emit: (_output: AgentOutput) => void;
  /** Fires before processing each queued message. */
  onTurnStart?: (_message: AgentInputMessage) => void;
  /** Fires in the `finally` after each message is processed. */
  onTurnEnd?: (_result: AgentTurnEndResult) => void;
  args?: { sessionId?: string };
  initialAgentMode?: AgentMode;
}

export interface AgentHarnessHandle {
  /**
   * Enqueues a user message for the harness loop. Optional overrides update
   * the model / agent mode before the message is processed.
   */
  queueMessage(
    _message: AgentInputMessage,
    _overrides?: { model?: string; agentMode?: AgentMode },
  ): void;
  /** Aborts the in-flight turn, if any. Safe to call when idle. */
  cancel(): void;
  /**
   * Stops the loop cleanly. Any in-flight turn is allowed to finish;
   * subsequent queued messages are dropped. Resolves once the loop exits.
   */
  shutdown(): Promise<void>;
}

interface QueueEntry {
  message: AgentInputMessage;
  model?: string;
  agentMode?: AgentMode;
}

const SHUTDOWN_POISON: QueueEntry = Object.freeze({
  message: { content: "__SHUTDOWN__" },
}) as QueueEntry;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

function getHeartbeatIntervalMs(): number {
  const rawValue = process.env.VM_AGENT_HEARTBEAT_INTERVAL_MS;
  if (!rawValue) return DEFAULT_HEARTBEAT_INTERVAL_MS;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_HEARTBEAT_INTERVAL_MS;
  return value;
}

/**
 * Starts the agent harness loop and returns a handle for the caller to drive
 * it. Setup runs lazily, triggered by the first queued message.
 */
export function startAgentHarness<S extends AgentSettings>(
  opts: AgentHarnessOptions<S>,
): AgentHarnessHandle {
  const { config, settings, emit, onTurnStart, onTurnEnd } = opts;

  const sessionId = process.env.SESSION_ID ?? "";
  const sessionSuffix = sessionId.slice(0, 4);
  const args = opts.args ?? {};

  const pendingMessages: QueueEntry[] = [];
  let messageResolver: ((_entry: QueueEntry) => void) | null = null;

  function queueMessage(
    message: AgentInputMessage,
    overrides?: { model?: string; agentMode?: AgentMode },
  ): void {
    if (stopped) return;
    const entry: QueueEntry = {
      message,
      model: overrides?.model,
      agentMode: overrides?.agentMode,
    };
    if (messageResolver) {
      // already awaiting a message, resolve the current promise
      const resolve = messageResolver;
      messageResolver = null;
      resolve(entry);
    } else {
      pendingMessages.push(entry);
    }
  }

  function consumeUserMessageQueue(): Promise<QueueEntry> {
    return new Promise((resolve) => {
      const pending = pendingMessages.shift();
      if (pending !== undefined) {
        resolve(pending);
      } else {
        // no pending messages yet, assign the resolver so `queueMessage` can resolve it when a message is added
        messageResolver = resolve;
      }
    });
  }

  let stopped = false;
  let loopDone: Promise<void> | null = null;
  let currentAbortController: AbortController | null = null;
  let setupResult: SetupResult<S["model"]> | null = null;
  let agentMode: AgentMode = opts.initialAgentMode ?? "edit";

  function cancel(): void {
    currentAbortController?.abort();
  }

  async function shutdown(): Promise<void> {
    stopped = true;
    // Unblock the loop if it is waiting on an empty queue.
    if (messageResolver) {
      const resolve = messageResolver;
      messageResolver = null;
      resolve(SHUTDOWN_POISON);
    }
    if (loopDone) await loopDone;
  }

  async function processMessage(entry: QueueEntry): Promise<AgentTurnEndResult> {
    const { message } = entry;
    if (!setupResult) return { aborted: false };

    if (entry.model) {
      setupResult.modelId = entry.model as S["model"];
      emit({ type: "debug", message: `Model updated to: ${entry.model}` });
    }
    if (entry.agentMode) {
      agentMode = entry.agentMode;
      emit({ type: "debug", message: `Agent mode updated to: ${entry.agentMode}` });
    }

    currentAbortController = new AbortController();

    const userContentParts: UserContent = [];
    if (message.content) {
      userContentParts.push({ type: "text", text: message.content });
    }
    for (const attachment of message.attachments ?? []) {
      userContentParts.push({
        type: "image",
        image: attachment.dataUrl,
        mediaType: attachment.mediaType,
      });
    }
    const heartbeatInterval = setInterval(() => {
      emit({ type: "heartbeat" });
    }, getHeartbeatIntervalMs());

    let finishReason: string | undefined;
    let aborted = false;
    try {
      const extras = setupResult.getStreamTextExtras?.() ?? {};
      const model = setupResult.getModel(setupResult.modelId, { agentMode });
      emit({ type: "debug", message: `Using model: ${setupResult.modelId}, agentMode: ${agentMode}` });
      const result = streamText({
        model,
        messages: [{ role: "user", content: userContentParts }],
        abortSignal: currentAbortController.signal,
        ...extras,
      });

      for await (const chunk of result.toUIMessageStream()) {
        if (chunk.type === "finish") {
          finishReason = chunk.finishReason;
        }
        emit({ type: "stream", chunk });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        aborted = true;
        finishReason = "abort";
        emit({ type: "stream", chunk: { type: "finish", finishReason: "abort" } });
      } else {
        emit({ type: "error", error: String(e) });
      }
    } finally {
      clearInterval(heartbeatInterval);
      currentAbortController = null;
    }
    return { finishReason, aborted };
  }

  async function ensureSetup(): Promise<boolean> {
    if (setupResult) return true;

    let spriteContext = "";
    try {
      spriteContext = readFileSync("/.sprite/llm.txt", { encoding: "utf-8" }).trim();
    } catch (error) {
      emit({
        type: "debug",
        message:
          "Could not read /.sprite/llm.txt" +
          (error instanceof Error ? error.message : String(error)),
      });
    }

    try {
      setupResult = await config.setup({
        emit,
        settings,
        agentMode,
        sessionSuffix,
        args,
        spriteContext,
      });
    } catch (error) {
      emit({ type: "error", error: String(error) });
      return false;
    }

    emit({ type: "ready" });

    if (setupResult.cleanup) {
      const cleanup = setupResult.cleanup;
      process.on("beforeExit", async () => {
        try {
          await cleanup();
        } catch (error) {
          emit({ type: "debug", message: `Cleanup error: ${String(error)}` });
        }
      });
    }

    return true;
  }

  async function runLoop(): Promise<void> {
    while (!stopped) {
      const entry = await consumeUserMessageQueue();
      if (stopped || entry === SHUTDOWN_POISON) break;

      const ready = await ensureSetup();
      if (!ready) continue;

      emit({
        type: "debug",
        message: `processing message: contentLength=${entry.message.content?.length ?? 0}, attachments=${entry.message.attachments?.length ?? 0}`,
      });

      onTurnStart?.(entry.message);
      try {
        const result = await processMessage(entry);
        onTurnEnd?.(result);
      } catch (error) {
        emit({ type: "error", error: String(error) });
        onTurnEnd?.({ aborted: false });
      }
    }
  }

  loopDone = runLoop();

  return { queueMessage, cancel, shutdown };
}
