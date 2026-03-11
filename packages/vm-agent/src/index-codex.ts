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
import { parseArgs } from "util";
import {
  type AgentInput,
  type AgentInputMessage,
  type AgentOutput,
  decodeAgentInput,
  encodeAgentOutput,
} from "@repo/shared";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { buildSystemPromptAppend } from "./system-prompt";

const { values: args } = parseArgs({
  options: {
    sessionId: { type: "string", short: "s" },
  },
});

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

const pendingMessages: AgentInputMessage[] = [];
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
let codexProvider: ReturnType<typeof createCodexAppServer> | null = null;

async function processMessage(message: AgentInputMessage): Promise<void> {
  if (!codexProvider) return;

  currentAbortController = new AbortController();
  const modelId = process.env.CODEX_MODEL ?? "gpt-5.3-codex";
  const userContentParts: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: string; mediaType: string }
  > = [];
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
    const result = streamText({
      model: codexProvider(modelId),
      messages: [{ role: "user", content: userContentParts }],
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

  // Resolve the system-installed codex binary path to avoid the bundled
  // require resolution, which may find a cached @openai/codex missing the
  // platform-specific native dependency (e.g. @openai/codex-linux-x64).
  let codexPath: string | undefined;
  try {
    codexPath = execSync("which codex", { encoding: "utf-8" }).trim();
    emit({ type: "debug", message: `Resolved codex path: ${codexPath}` });
  } catch {
    emit({ type: "debug", message: "Could not resolve codex path via 'which'; using default resolution" });
  }

  codexProvider = createCodexAppServer({
    defaultSettings: {
      minCodexVersion: "0.104.0",
      autoApprove: true,
      sandboxPolicy: "workspace-write",
      personality: "pragmatic",
      baseInstructions: systemPromptAppend,
      codexPath,
      resume: args.sessionId,
    },
  });

  emit({ type: "ready" });
  emit({
    type: "debug",
    message: `Codex app-server provider initialized (model: ${process.env.CODEX_MODEL ?? "gpt-5.3-codex"})`,
  });

  while (true) {
    const message = await waitForMessage();
    emit({
      type: "debug",
      message: `processing message: contentLength=${message.content?.length ?? 0}, attachments=${message.attachments?.length ?? 0}`,
    });
    await processMessage(message);
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
      queueMessage(input.message);
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
    } catch (error) {
      // Ignore cleanup errors
      emit({ type: "debug", message: "Error closing codex provider: " + String(error) });
    }
  }
});
