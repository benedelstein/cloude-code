import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { parseArgs } from "util";
import {
  type AgentInput,
  type AgentOutput,
  decodeAgentInput,
  encodeAgentOutput,
} from "@repo/shared";

const { values: args } = parseArgs({
  options: {
    sessionId: { type: "string", short: "s" },
  },
});

const rl = createInterface({ input: process.stdin });

function emit(output: AgentOutput): void {
  process.stdout.write(encodeAgentOutput(output) + "\n");
}

// Streaming input message type (matches SDK docs example)
// The SDK types require additional fields but runtime accepts this simpler form
type StreamingUserMessage = {
  type: "user";
  message: {
    role: "user";
    content: string | Array<{ type: string; text?: string; source?: unknown }>;
  };
};

// Message queue for streaming input mode
type QueuedMessage = {
  resolve: (value: StreamingUserMessage | null) => void;
};
const messageQueue: QueuedMessage[] = [];
let isRunning = false;
let currentQuery: Query | null = null;

/**
 * Async generator that yields user messages as they arrive via stdin.
 * This enables streaming input mode for the Agent SDK.
 */
async function* generateMessages(): AsyncGenerator<StreamingUserMessage> {
  while (true) {
    const msg = await new Promise<StreamingUserMessage | null>((resolve) => {
      messageQueue.push({ resolve });
    });

    // null signals shutdown
    if (msg === null) break;

    yield msg;
  }
}

/**
 * Start the agent query with streaming input mode.
 * This creates a single long-lived session that accepts messages via the generator.
 */
async function startAgent(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  const claudeExecutablePath = execSync("which claude", { encoding: "utf-8" }).trim();

  try {
    // Cast to any to bypass strict SDK types - runtime accepts the simpler message format
    // per the official docs: https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
    currentQuery = query({
      prompt: generateMessages() as any,
      options: {
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
        cwd: process.cwd(),
        resume: args.sessionId,
        permissionMode: "acceptEdits",
        pathToClaudeCodeExecutable: claudeExecutablePath,
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
          network: {
            allowLocalBinding: true,
            allowAllUnixSockets: true,
          },
        },
      },
    });

    for await (const message of currentQuery) {
      if (message.type === "system" && message.subtype === "init") {
        emit({ type: "ready", sessionId: message.session_id, claudeExecutablePath: claudeExecutablePath });
      }
      emit({ type: "sdk", message });
    }
  } catch (e) {
    emit({ type: "error", error: String(e) });
  } finally {
    isRunning = false;
    currentQuery = null;
  }
}

// Handle incoming messages from stdin
rl.on("line", async (line) => {
  let input: AgentInput;
  try {
    input = decodeAgentInput(line);
  } catch (e) {
    emit({ type: "error", error: `Invalid input: ${e}` });
    return;
  }

  switch (input.type) {
    case "chat":
      // Start agent on first message if not running
      if (!isRunning) {
        // Start agent in background, don't await
        startAgent();
        // Give the generator time to set up
        await new Promise((r) => setTimeout(r, 10));
      }

      // Push message to the queue for the generator to yield
      const pending = messageQueue.shift();
      if (pending) {
        pending.resolve({
          type: "user",
          message: { role: "user", content: input.content },
        });
      }
      break;

    case "cancel":
      await currentQuery?.interrupt();
      break;

    case "resume":
      // In streaming mode, we don't need explicit resume - session is maintained
      // But we can restart with a new session if needed
      emit({ type: "error", error: "Resume not supported in streaming mode - session is maintained automatically" });
      break;
  }
});

// Keep process alive
process.stdin.resume();
