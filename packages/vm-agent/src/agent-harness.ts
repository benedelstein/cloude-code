/**
 * Shared agent harness that owns stdin/stdout protocol, message queue,
 * and the streamText processing loop. Providers plug in via AgentProviderConfig.
 */
import {
  type LanguageModel,
  type StreamTextOnStepFinishCallback,
  type ToolSet,
  type UserContent,
  streamText,
} from "ai";
import { createInterface } from "readline";
import { parseArgs } from "util";
import { readFileSync } from "fs";
import {
  type AgentInput,
  type AgentInputMessage,
  type AgentOutput,
  type AgentSettings,
  decodeAgentInput,
  encodeAgentOutput,
} from "@repo/shared";

export interface ProviderSetupContext<S extends AgentSettings = AgentSettings> {
  // eslint-disable-next-line no-unused-vars
  emit: (_output: AgentOutput) => void;
  settings: S;
  sessionSuffix: string;
  args: { sessionId?: string };
  spriteContext: string;
}

export type StreamTextExtras = {
  providerOptions?: Parameters<typeof streamText>[0]["providerOptions"];
  onStepFinish?: StreamTextOnStepFinishCallback<ToolSet>;
};

export type GetModelOptions = {
  agentMode?: "edit" | "plan";
};

export interface SetupResult<ModelId extends string = AgentSettings["model"]> {
  modelId: ModelId;
  agentMode: "edit" | "plan";
  // eslint-disable-next-line no-unused-vars
  getModel: (_modelId: ModelId, _options?: GetModelOptions) => LanguageModel;
  getStreamTextExtras?: () => StreamTextExtras;
  cleanup?: () => Promise<void>;
}

export interface AgentProviderConfig<S extends AgentSettings = AgentSettings> {
  // eslint-disable-next-line no-unused-vars
  setup(_context: ProviderSetupContext<S>): Promise<SetupResult<S["model"]>>;
}

export async function runAgentHarness<S extends AgentSettings>(config: AgentProviderConfig<S>, settings: S): Promise<void> {
  const { values: parsedValues } = parseArgs({
    options: {
      sessionId: { type: "string", short: "s" },
    },
    strict: false,
  });
  const args = { sessionId: typeof parsedValues.sessionId === "string" ? parsedValues.sessionId : undefined };

  const sessionId = process.env.SESSION_ID ?? "";
  const sessionSuffix = sessionId.slice(0, 4);

  const rl = createInterface({ input: process.stdin });

  function emit(output: AgentOutput): void {
    process.stdout.write(encodeAgentOutput(output) + "\n");
  }

  // Message queue
  const pendingMessages: AgentInputMessage[] = [];
  // eslint-disable-next-line no-unused-vars
  let messageResolver: ((message: AgentInputMessage) => void) | null = null;

  function queueMessage(message: AgentInputMessage): void {
    if (messageResolver) {
      const resolve = messageResolver;
      messageResolver = null;
      resolve(message);
    } else {
      pendingMessages.push(message);
    }
  }

  function waitForMessage(): Promise<AgentInputMessage> {
    return new Promise((resolve) => {
      const pending = pendingMessages.shift();
      if (pending !== undefined) {
        resolve(pending);
      } else {
        messageResolver = resolve;
      }
    });
  }

  let isRunning = false;
  let currentAbortController: AbortController | null = null;
  /**
   * Stores provider settings for the session.
   */
  let setupResult: SetupResult<S["model"]> | null = null;

  // Buffer model/agentMode from the first message so they can be applied
  // after provider setup completes (setupResult is null until then).
  let pendingModelId: string | null = null;
  let pendingAgentMode: ("edit" | "plan") | null = null;

  async function processMessage(message: AgentInputMessage): Promise<void> {
    if (!setupResult) return;
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

    try {
      const extras = setupResult.getStreamTextExtras?.() ?? {};
      const model = setupResult.getModel(setupResult.modelId, { agentMode: setupResult.agentMode });
      emit({ type: "debug", message: `Using model: ${setupResult.modelId}, agentMode: ${setupResult.agentMode}` });
      const result = streamText({
        model,
        messages: [{ role: "user", content: userContentParts }],
        abortSignal: currentAbortController.signal,
        ...extras,
      });

      for await (const chunk of result.toUIMessageStream()) {
        emit({ type: "stream", chunk });
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        emit({ type: "stream", chunk: { type: "finish", finishReason: "abort" } });
      } else {
        emit({ type: "error", error: String(e) });
      }
    } finally {
      currentAbortController = null;
    }
  }

  async function runAgent(): Promise<void> {
    if (isRunning) return;
    isRunning = true;

    // Read sprite context
    let spriteContext = "";
    try {
      spriteContext = readFileSync("/.sprite/llm.txt", { encoding: "utf-8" }).trim();
    } catch (error) {
      emit({ type: "debug", message: "Could not read /.sprite/llm.txt" + (error instanceof Error ? error.message : String(error)) });
    }

    try {
      setupResult = await config.setup({ emit, settings, sessionSuffix, args, spriteContext });
    } catch (error) {
      emit({ type: "error", error: String(error) });
      isRunning = false;
      return;
    }

    // Apply any model/agentMode buffered from the first message
    if (pendingModelId) {
      setupResult.modelId = pendingModelId as S["model"];
      emit({ type: "debug", message: `Applied pending model: ${pendingModelId}` });
      pendingModelId = null;
    }
    if (pendingAgentMode) {
      setupResult.agentMode = pendingAgentMode;
      emit({ type: "debug", message: `Applied pending agent mode: ${pendingAgentMode}` });
      pendingAgentMode = null;
    }

    emit({ type: "ready" });

    // Register cleanup if provided
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

    while (true) {
      const message = await waitForMessage();
      emit({
        type: "debug",
        message: `processing message: contentLength=${message.content?.length ?? 0}, attachments=${message.attachments?.length ?? 0}`,
      });
      await processMessage(message);
    }
  }

  // stdin listener
  rl.on("line", async (rawLine) => {
    const line = rawLine.charCodeAt(0) === 0 ? rawLine.slice(1) : rawLine;

    let input: AgentInput;
    try {
      input = decodeAgentInput(line);
    } catch (e) {
      emit({ type: "error", error: `Invalid input: ${e}` });
      return;
    }

    switch (input.type) {
      case "chat":
        if (!isRunning) {
          runAgent();
        }
        // Apply model switch if provided
        if (input.model) {
          if (setupResult) {
            setupResult.modelId = input.model as S["model"];
            emit({ type: "debug", message: `Model updated to: ${input.model}` });
          } else {
            pendingModelId = input.model;
          }
        }
        // Apply agent mode switch if provided
        if (input.agentMode) {
          if (setupResult) {
            setupResult.agentMode = input.agentMode;
            emit({ type: "debug", message: `Agent mode updated to: ${input.agentMode}` });
          } else {
            pendingAgentMode = input.agentMode;
          }
        }
        queueMessage(input.message);
        break;

      case "cancel":
        emit({ type: "debug", message: "cancel received; aborting current operation" });
        currentAbortController?.abort();
        break;

      case "resume":
        emit({ type: "error", error: "Resume not supported - use sessionId arg at startup" });
        break;
    }
  });

  process.stdin.resume();
}
