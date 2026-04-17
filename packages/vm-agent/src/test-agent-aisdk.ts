import { spawn } from "child_process";
import { createInterface } from "readline";
import { parseArgs } from "util";
import { AgentOutput, encodeAgentInput, MessageAccumulator, UIMessageChunk } from "@repo/shared";

const { values } = parseArgs({
  options: {
    provider: { type: "string", short: "p", default: "claude-code" },
    model: { type: "string", short: "m" },
    sessionId: { type: "string", short: "s" },
    rotateModels: { type: "boolean", short: "r", default: false },
  },
  strict: false,
});

const provider = String(values.provider ?? "claude-code");
const defaultModel = provider === "openai-codex" ? "gpt-5.3-codex" : "opus";
const model = String(values.model ?? defaultModel);
const sessionId = values.sessionId ? String(values.sessionId) : undefined;
const rotateModels = values.rotateModels === true;

const MODEL_ROTATION: Record<string, string[]> = {
  "claude-code": ["opus", "sonnet", "haiku"],
  "openai-codex": ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.2"],
};
let rotationIndex = 0;
const settings = JSON.stringify({ provider, model });

console.log(`vm-agent test harness (provider: ${provider}, model: ${model})`);

// Spawn the AI SDK agent process
const spawnArgs = ["run", "src/index.ts", "--provider", settings];
if (sessionId) {
  spawnArgs.push("--sessionId", sessionId);
}
const agent = spawn("bun", spawnArgs, {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    VM_AGENT_LOCAL: "1",
  },
});

// Run each stream chunk through the same validator the DO uses in production.
// Orphan-chunk warnings surface via the default ConsoleLogger.
const accumulator = new MessageAccumulator();

// Read agent output
const agentOutput = createInterface({ input: agent.stdout! });
agentOutput.on("line", (line) => {
  try {
    const rawOutput = JSON.parse(line);
    // Format based on AI SDK part types
    const output = AgentOutput.parse(rawOutput);
    switch (output.type) {
      case "ready":
        console.log(`\nAgent ready`);
        break;
      case "debug":
        console.log(`[debug] ${output.message}`);
        break;
      case "stream": {
        const chunk = output.chunk as UIMessageChunk | undefined;
        if (chunk) {
          const { finishedMessage } = accumulator.process(chunk);
          if (finishedMessage) {
            // Reset for the next turn so orphan detection isn't polluted by prior state.
            accumulator.reset();
          }
        }
        if (chunk?.type === "text-delta") {
          process.stdout.write(chunk.delta);
        } else if (chunk?.type === "finish") {
          console.log(`\nFinished (${chunk.finishReason})`);
        } else {
          console.log(`.`);
        }
        break;
      }
      case "error":
        console.log(`\nError: ${output.error}`);
        break;
      case "sessionId":
        console.log(`[session] ${output.sessionId}`);
        break;
      default:
        console.log("output:", JSON.stringify(output, null, 2));
    }
  } catch {
    console.log("raw:", line);
  }
});

// Read user input
const userInput = createInterface({ input: process.stdin, output: process.stdout });

console.log("Type a message to send to the agent. Ctrl+C to exit.\n");

userInput.on("line", (line) => {
  if (line === "/cancel") {
    const message = encodeAgentInput({ type: "cancel" });
    console.log(`\nCancelling...`);
    agent.stdin!.write(message + "\n");
    return;
  }

  let nextModel: string | undefined;
  if (rotateModels) {
    const models = MODEL_ROTATION[provider] ?? [];
    nextModel = models[rotationIndex % models.length];
    rotationIndex++;
    console.log(`\n[rotate] model: ${nextModel}`);
  }

  const message = encodeAgentInput({ type: "chat", message: { content: line }, model: nextModel });
  console.log(`\nSending: ${line}`);
  agent.stdin!.write(message + "\n");
});

agent.on("exit", (code) => {
  console.log(`\nAgent exited with code ${code}`);
  process.exit(code ?? 0);
});
