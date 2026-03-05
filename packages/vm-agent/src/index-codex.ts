/**
 * VM-agent using ai-sdk-provider-codex-cli (codexAppServer mode)
 * Emits AI SDK UIMessageChunk events wrapped in AgentOutput.
 *
 * Authentication: Reads CODEX_AUTH_JSON env var and writes it to
 * ~/.codex/auth.json so the codex CLI can use OAuth tokens.
 * Falls back to OPENAI_API_KEY if set.
 */
import { createCodexAppServer } from "ai-sdk-provider-codex-cli";
import { streamText } from "ai";
import { createInterface } from "readline";
import {
  type AgentInput,
  type AgentOutput,
  decodeAgentInput,
  encodeAgentOutput,
} from "@repo/shared";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildSystemPromptAppend } from "./system-prompt";

const sessionId = process.env.SESSION_ID ?? "";
const sessionSuffix = sessionId.slice(0, 4);

const rl = createInterface({ input: process.stdin });

function emit(output: AgentOutput): void {
  process.stdout.write(encodeAgentOutput(output) + "\n");
}

// ============================================
// OAuth token setup
// ============================================

function setupCodexAuth(): void {
  const authJson = process.env.CODEX_AUTH_JSON;
  if (authJson) {
    const codexDir = join(homedir(), ".codex");
    if (!existsSync(codexDir)) {
      mkdirSync(codexDir, { recursive: true });
    }
    writeFileSync(join(codexDir, "auth.json"), authJson, { mode: 0o600 });
    emit({ type: "debug", message: "Wrote ~/.codex/auth.json from CODEX_AUTH_JSON env" });
  } else if (process.env.OPENAI_API_KEY) {
    emit({ type: "debug", message: "Using OPENAI_API_KEY for codex authentication" });
  } else {
    emit({
      type: "error",
      error: "No codex authentication found. Set CODEX_AUTH_JSON or OPENAI_API_KEY.",
    });
  }
}

// ============================================
// Message queue (same pattern as index-aisdk.ts)
// ============================================

const pendingMessages: string[] = [];
let messageResolver: ((content: string) => void) | null = null;

function queueMessage(content: string): void {
  if (messageResolver) {
    const resolve = messageResolver;
    messageResolver = null;
    resolve(content);
  } else {
    pendingMessages.push(content);
  }
}

function waitForMessage(): Promise<string> {
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
let codexProvider: ReturnType<typeof createCodexAppServer> | null = null;

async function processMessage(content: string): Promise<void> {
  if (!codexProvider) return;

  currentAbortController = new AbortController();
  const modelId = process.env.CODEX_MODEL ?? "gpt-5.3-codex";

  try {
    const result = streamText({
      model: codexProvider(modelId),
      prompt: content,
      abortSignal: currentAbortController.signal,
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

  setupCodexAuth();

  const systemPromptAppend = buildSystemPromptAppend(sessionSuffix);

  codexProvider = createCodexAppServer({
    defaultSettings: {
      minCodexVersion: "0.105.0",
      autoApprove: false,
      personality: "pragmatic",
      baseInstructions: systemPromptAppend,
    },
  });

  emit({ type: "ready" });
  emit({
    type: "debug",
    message: `Codex app-server provider initialized (model: ${process.env.CODEX_MODEL ?? "gpt-5.3-codex"})`,
  });

  while (true) {
    const content = await waitForMessage();
    emit({ type: "debug", message: `processing message: ${content}` });
    await processMessage(content);
  }
}

// ============================================
// stdin listener (same protocol as claude agent)
// ============================================

rl.on("line", async (rawLine) => {
  const line = rawLine.charCodeAt(0) === 0 ? rawLine.slice(1) : rawLine;

  let input: AgentInput;
  emit({ type: "debug", message: `received input: ${line}` });
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
      queueMessage(input.content);
      break;

    case "cancel":
      emit({ type: "debug", message: "cancel received; aborting current operation" });
      currentAbortController?.abort();
      break;

    case "resume":
      emit({ type: "error", error: "Resume not yet supported for codex-cli provider" });
      break;
  }
});

process.stdin.resume();

// Cleanup on exit
process.on("beforeExit", async () => {
  if (codexProvider) {
    try {
      await codexProvider.close();
    } catch {
      // Ignore cleanup errors
    }
  }
});
