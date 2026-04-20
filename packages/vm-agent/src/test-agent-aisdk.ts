import { spawn } from "child_process";
import { createInterface } from "readline";
import { parseArgs } from "util";
import { AgentOutput, CLAUDE_PROVIDER, encodeAgentInput, MessageAccumulator, OPENAI_CODEX_PROVIDER, OPENAI_CODEX_PROVIDER_ID, UIMessageChunk } from "@repo/shared";

const { values } = parseArgs({
  options: {
    provider: { type: "string", short: "p", default: "openai-codex" },
    model: { type: "string", short: "m" },
    sessionId: { type: "string", short: "s" },
    rotateModels: { type: "boolean", short: "r", default: false },
  },
  strict: false,
});

const provider = String(values.provider ??  OPENAI_CODEX_PROVIDER_ID);
const defaultModel = provider === "openai-codex" ? "gpt-5.3-codex" : "opus";
const model = String(values.model ?? defaultModel);
const sessionId = values.sessionId ? String(values.sessionId) : undefined;
const rotateModels = values.rotateModels === true;

const MODEL_ROTATION: Record<string, string[]> = {
  "claude-code": CLAUDE_PROVIDER.models.map((model) => model.id),
  "openai-codex": OPENAI_CODEX_PROVIDER.models.map((model) => model.id),
};
let rotationIndex = 0;
const settings = JSON.stringify({ provider, model });

console.log(`vm-agent test harness (provider: ${provider}, model: ${model})${sessionId ? `, sessionId: ${sessionId}` : ""}`);

// Timeline debugging: timestamp every emitted line relative to the start of
// the current turn so we can see when onStepFinish fires vs stream chunks.
let turnStart = Date.now();
const elapsed = () => `+${String(Date.now() - turnStart).padStart(5, " ")}ms`;
const log = (tag: string, ...rest: unknown[]) => console.log(`[${elapsed()}] ${tag}`, ...rest);

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
        log("ready", "Agent ready");
        break;
      case "debug": {
        // Highlight onStepFinish arrivals so they're easy to spot in the timeline.
        const isStepFinish = output.message.startsWith("step finished");
        log(isStepFinish ? "STEP-FINISH" : "debug", output.message);
        break;
      }
      case "stream": {
        const chunk = output.chunk as UIMessageChunk | undefined;
        if (chunk) {
          const { finishedMessage } = accumulator.process(chunk);
          if (finishedMessage) {
            accumulator.reset();
            log("finishedMessage", finishedMessage);
          }
        }
        if (chunk?.type === "text-delta") {
          // log("text-delta", JSON.stringify(chunk.delta));
        } else if (chunk?.type === "finish") {
          log("FINISH-CHUNK", `reason=${chunk.finishReason}`);
        } else {
          log("chunk", chunk?.type);
        }
        break;
      }
      case "error":
        log("error", output.error);
        break;
      case "sessionId":
        log("SESSION-ID", output.sessionId);
        break;
      default:
        log("output", JSON.stringify(output));
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
  turnStart = Date.now();
  log("send", line);
  agent.stdin!.write(message + "\n");
});

agent.on("exit", (code) => {
  console.log(`\nAgent exited with code ${code}`);
  process.exit(code ?? 0);
});
