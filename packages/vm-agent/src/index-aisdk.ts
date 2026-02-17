/**
 * VM-agent using ai-sdk-provider-claude-code
 * Emits AI SDK UIMessageChunk events wrapped in AgentOutput.
 */
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { LanguageModel, streamText } from "ai";
import { createInterface } from "readline";
import { parseArgs } from "util";
import {
  type AgentInput,
  type AgentOutput,
  decodeAgentInput,
  encodeAgentOutput,
} from "@repo/shared";
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

// Debug: check env vars on startup
const apiKey = process.env.ANTHROPIC_API_KEY;
emit({
  type: "debug",
  message: `ANTHROPIC_API_KEY: ${apiKey ? `set (${apiKey.slice(0, 10)}...)` : "NOT SET"}`,
});

// Pending messages waiting to be processed
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

// Track session ID from Claude - updated after first message
let claudeSessionId: string | undefined;

async function processMessage(model: LanguageModel, content: string): Promise<void> {
  currentAbortController = new AbortController();

  try {
    const result = streamText({
      model,
      prompt: content,
      abortSignal: currentAbortController.signal,
      ...(claudeSessionId && {
        experimental_providerMetadata: { claudeCode: { resume: claudeSessionId } },
      }),
      onStepFinish: (step) => {
        // Extract session ID from step's provider metadata
        const sessionId = (step.providerMetadata?.["claude-code"] as { sessionId?: string })?.sessionId;
        if (sessionId && sessionId !== claudeSessionId) {
          claudeSessionId = sessionId;
          emit({ type: "debug", message: `Claude session ID: ${claudeSessionId}` });
          emit({ type: "sessionId", sessionId: claudeSessionId });
        }
      },
    });

    // Stream UI message chunks
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

  let claudeExecutablePath: string;
  try {
    claudeExecutablePath = execSync("which claude", { encoding: "utf-8" }).trim();
    emit({ type: "debug", message: `claude executable path: ${claudeExecutablePath}` });
  } catch (e) {
    emit({ type: "error", error: `Failed to find claude executable: ${e}` });
    isRunning = false;
    return;
  }

  // Note: We don't have the real Claude session ID until after the first message.
  // The SDK doesn't expose it, so we can't support session resume yet.
  emit({
    type: "ready",
    // No sessionId - each vm-agent run is a fresh session
  });

  const claudeCodeProvider = createClaudeCode({
    defaultSettings: {
      pathToClaudeCodeExecutable: claudeExecutablePath,
      allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      cwd: process.cwd(),
      resume: args.sessionId, // FIXME: THIS CAUSES ISSUES WITH THE API
      permissionMode: "acceptEdits",
      includePartialMessages: false,
      persistSession: true,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: buildSystemPromptAppend(sessionSuffix),
      },
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      },
      stderr: (data) => {
        emit({ type: "debug", message: `claude-cli stderr: ${data}` });
      },
    },
  });

  const model = claudeCodeProvider("opus", { settingSources: ["local", "project", "user"] });

  while (true) {
    const content = await waitForMessage();
    emit({ type: "debug", message: `processing message: ${content}` });
    await processMessage(model, content);
  }
}

rl.on("line", async (rawLine) => {
  // Strip leading null byte (stream ID 0) if present from non-TTY sprite protocol
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
      currentAbortController?.abort();
      break;

    case "resume":
      emit({ type: "error", error: "Resume not supported - use sessionId arg at startup" });
      break;
  }
});

process.stdin.resume();