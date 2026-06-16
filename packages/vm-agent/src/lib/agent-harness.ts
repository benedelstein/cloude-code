/**
 * Shared agent harness. Owns provider setup, the message queue, and the
 * streamText processing loop — but NOT its edges. Input/output and lifecycle
 * hooks are injected by the caller, so the same harness drives the legacy
 * stdio runner and the new webhook runner.
 */
import type {
  StreamTextOnErrorCallback,
} from "ai";
import {
  type LanguageModel,
  type StreamTextOnStepFinishCallback,
  type ToolSet,
  type UserContent,
  streamText,
} from "ai";
import { readFileSync } from "fs";
import type {
  AgentMode,
  AgentInputMessage,
  AgentOutput,
  AgentSettings,
} from "@repo/shared";
import { QuestionRegistry } from "./question-registry";

export interface ProviderSetupContext<S extends AgentSettings = AgentSettings> {
  emit: (_output: AgentOutput) => void;
  settings: S;
  agentMode: AgentMode;
  sessionSuffix: string;
  args: { sessionId?: string };
  spriteContext: string;
  /** Tracks blocking ask_user questions awaiting a user response. */
  questionRegistry: QuestionRegistry;
}

export type StreamTextExtras = {
  providerOptions?: Parameters<typeof streamText>[0]["providerOptions"];
  onStepFinish?: StreamTextOnStepFinishCallback<ToolSet>;
  onError?: StreamTextOnErrorCallback;
};

export type GetModelOptions = {
  agentMode: AgentMode;
  effort?: string;
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
  onTurnStart?: (_message: AgentInputMessage, _turnId: string) => void;
  /**
   * Fires in the `finally` after each message is processed. The loop awaits
   * this callback, so async cleanup (e.g. flushing batched chunks) runs to
   * completion before the next iteration starts or shutdown progresses.
   */
  onTurnEnd?: (_result: AgentTurnEndResult) => void | Promise<void>;
  /** Fires when provider setup fails after the first queued message is claimed. */
  onSetupError?: (_error: unknown) => void | Promise<void>;
  args?: { sessionId?: string };
  initialAgentMode?: AgentMode;
  /** Shared registry for blocking ask_user questions. Defaults to a new one. */
  questionRegistry?: QuestionRegistry;
}

export interface AgentHarnessHandle {
  /**
   * Enqueues a user message for the harness loop. Optional overrides update
   * the model / agent mode before the message is processed.
   */
  queueMessage(
    _message: AgentInputMessage,
    _turnId: string,
    _overrides?: { model?: string; effort?: string; agentMode?: AgentMode },
  ): void;
  /** Aborts the in-flight turn, or removes a matching queued turn. */
  cancelTurn(_turnId?: string): boolean;
  /**
   * Stops the loop cleanly. Any in-flight turn is allowed to finish;
   * subsequent queued messages are dropped. Resolves once the loop exits.
   */
  shutdown(): Promise<void>;
}

interface QueueEntry {
  message: AgentInputMessage;
  model?: string;
  effort?: string;
  agentMode?: AgentMode;
  turnId: string;
  abortController: AbortController;
}

const SHUTDOWN_POISON: QueueEntry = Object.freeze({
  message: { content: "__SHUTDOWN__" },
  turnId: "__SHUTDOWN__",
  abortController: new AbortController(),
}) as QueueEntry;
/**
 * Starts the agent harness loop and returns a handle for the caller to drive
 * it. Setup runs lazily, triggered by the first queued message.
 */
export function startAgentHarness<S extends AgentSettings>(
  opts: AgentHarnessOptions<S>,
): AgentHarnessHandle {
  const { config, settings, emit, onTurnStart, onTurnEnd, onSetupError } = opts;

  const sessionId = process.env.SESSION_ID ?? "";
  const sessionSuffix = sessionId.slice(0, 4);
  const args = opts.args ?? {};
  const questionRegistry = opts.questionRegistry ?? new QuestionRegistry();

  const pendingMessages: QueueEntry[] = [];
  let messageResolver: ((_entry: QueueEntry) => void) | null = null;

  function queueMessage(
    message: AgentInputMessage,
    turnId: string,
    overrides?: { model?: string; effort?: string; agentMode?: AgentMode },
  ): void {
    if (stopped) { return; }
    const entry: QueueEntry = {
      message,
      model: overrides?.model,
      effort: overrides?.effort,
      agentMode: overrides?.agentMode,
      turnId,
      abortController: new AbortController(),
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
  let currentEntry: QueueEntry | null = null;
  let setupResult: SetupResult<S["model"]> | null = null;
  let agentMode: AgentMode = opts.initialAgentMode ?? "edit";
  let effort: string | undefined = settings.effort;

  function cancelTurn(turnId?: string): boolean {
    if (!turnId) {
      if (currentEntry) {
        currentEntry.abortController.abort();
        // Unblock any ask_user call waiting on this turn.
        questionRegistry.rejectAll(new Error("turn cancelled"));
      }
      return currentEntry !== null;
    }

    const pendingIndex = pendingMessages.findIndex(
      (entry) => entry.turnId === turnId,
    );
    if (pendingIndex !== -1) {
      pendingMessages[pendingIndex]!.abortController.abort();
      pendingMessages.splice(pendingIndex, 1);
      return true;
    }

    if (currentEntry?.turnId !== turnId) { return false; }
    currentEntry.abortController.abort();
    questionRegistry.rejectAll(new Error("turn cancelled"));
    return true;
  }

  async function shutdown(): Promise<void> {
    stopped = true;
    // Unblock the loop if it is waiting on an empty queue.
    if (messageResolver) {
      const resolve = messageResolver;
      messageResolver = null;
      resolve(SHUTDOWN_POISON);
    }
    // await the loop to finish processing.
    if (loopDone) { await loopDone; }
  }

  async function processMessage(entry: QueueEntry): Promise<AgentTurnEndResult> {
    const { message } = entry;
    if (!setupResult) { return { aborted: false }; }

    if (entry.model) {
      setupResult.modelId = entry.model as S["model"];
      emit({ type: "debug", message: `Model updated to: ${entry.model}` });
    }
    if (entry.effort) {
      effort = entry.effort;
      emit({ type: "debug", message: `Effort updated to: ${entry.effort}` });
    }
    if (entry.agentMode) {
      agentMode = entry.agentMode;
      emit({ type: "debug", message: `Agent mode updated to: ${entry.agentMode}` });
    }

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
    let finishReason: string | undefined;
    let aborted = false;
    try {
      const extras = setupResult.getStreamTextExtras?.() ?? {};
      const model = setupResult.getModel(setupResult.modelId, { agentMode, effort });
      const effortSuffix = effort ? `, effort: ${effort}` : "";
      emit({
        type: "debug",
        message: `Using model: ${setupResult.modelId}, agentMode: ${agentMode}${effortSuffix}`,
      });
      const result = streamText({
        model,
        messages: [{ role: "user", content: userContentParts }],
        abortSignal: entry.abortController.signal,
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
    }
    return { finishReason, aborted };
  }

  /** this will throw if setup fails. */
  async function ensureSetup(): Promise<void> {
    if (setupResult) { return; }

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

    setupResult = await config.setup({
      emit,
      settings,
      agentMode,
      sessionSuffix,
      args,
      spriteContext,
      questionRegistry,
    });

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
  }

  async function runLoop(): Promise<void> {
    while (!stopped) {
      const entry = await consumeUserMessageQueue();
      if (stopped || entry === SHUTDOWN_POISON) { break; }

      currentEntry = entry;

      try {
        await ensureSetup();
      } catch (error) {
        emit({ type: "error", error: String(error) });
        stopped = true;
        currentEntry = null;
        await onSetupError?.(error);
        return;
      }

      try {
        if (entry.abortController.signal.aborted) {
          // A scoped cancel may arrive after the loop claims the turn but
          // before streamText starts. Skip the model call in that case.
          await onTurnEnd?.({ finishReason: "abort", aborted: true });
          continue;
        }

        emit({
          type: "debug",
          message: `processing message: contentLength=${entry.message.content?.length ?? 0}, attachments=${entry.message.attachments?.length ?? 0}`,
        });

        onTurnStart?.(entry.message, entry.turnId);
        const result = await processMessage(entry);
        await onTurnEnd?.(result);
      } catch (error) {
        emit({ type: "error", error: String(error) });
        await onTurnEnd?.({ aborted: false });
      } finally {
        currentEntry = null;
      }
    }
  }

  loopDone = runLoop();

  return { queueMessage, cancelTurn, shutdown };
}
