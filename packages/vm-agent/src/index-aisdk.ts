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
  type AgentInputMessage,
  type AgentOutput,
  decodeAgentInput,
  encodeAgentOutput,
} from "@repo/shared";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
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

type ClaudeCredentials = {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
};

function setupClaudeCredentials(): void {
  const credentialsJson = process.env.CLAUDE_CREDENTIALS_JSON;
  if (!credentialsJson) {
    throw new Error(
      "Missing CLAUDE_CREDENTIALS_JSON. Claude OAuth credentials are required.",
    );
  }

  let parsed: ClaudeCredentials;
  try {
    parsed = JSON.parse(credentialsJson) as ClaudeCredentials;
  } catch (error) {
    throw new Error("CLAUDE_CREDENTIALS_JSON is not valid JSON.", {
      cause: error,
    });
  }

  const oauth = parsed.claudeAiOauth;
  if (
    !oauth ||
    typeof oauth.accessToken !== "string" ||
    typeof oauth.refreshToken !== "string" ||
    typeof oauth.expiresAt !== "number" ||
    !Array.isArray(oauth.scopes)
  ) {
    throw new Error("CLAUDE_CREDENTIALS_JSON missing required claudeAiOauth fields.");
  }

  const claudeDir = join(homedir(), ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, ".credentials.json"), credentialsJson, {
    mode: 0o600,
  });
  emit({ type: "debug", message: "Wrote ~/.claude/.credentials.json from CLAUDE_CREDENTIALS_JSON env" });
}

function clearConflictingAnthropicAuthEnvVars(): void {
  const conflictingKeys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;
  const removedKeys: string[] = [];

  for (const key of conflictingKeys) {
    if (process.env[key]) {
      delete process.env[key];
      removedKeys.push(key);
    }
  }

  if (removedKeys.length > 0) {
    emit({
      type: "debug",
      message: `Removed conflicting auth env vars: ${removedKeys.join(", ")}`,
    });
  }
}

// Pending messages waiting to be processed
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

// Track session ID from Claude - updated after first message
let claudeSessionId: string | undefined;

async function processMessage(model: LanguageModel, message: AgentInputMessage): Promise<void> {
  currentAbortController = new AbortController();
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
      model,
      messages: [{ role: "user", content: userContentParts }],
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

  try {
    setupClaudeCredentials();
    clearConflictingAnthropicAuthEnvVars();
  } catch (error) {
    emit({ type: "error", error: String(error) });
    isRunning = false;
    return;
  }

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
      streamingInput: "always",
      persistSession: true,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: buildSystemPromptAppend(sessionSuffix),
      },
      stderr: (data) => {
        emit({ type: "debug", message: `claude-cli stderr: ${data}` });
      },
    },
  });

  const model = claudeCodeProvider("opus", { settingSources: ["local", "project", "user"] });

  while (true) {
    const message = await waitForMessage();
    emit({
      type: "debug",
      message: `processing message: contentLength=${message.content?.length ?? 0}, attachments=${message.attachments?.length ?? 0}`,
    });
    await processMessage(model, message);
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
