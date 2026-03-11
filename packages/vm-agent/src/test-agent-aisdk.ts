import { spawn } from "child_process";
import { createInterface } from "readline";
import { encodeAgentInput } from "@repo/shared";


console.log("🤖 vm-agent (AI SDK) test harness");

// Spawn the AI SDK agent process
const agent = spawn("bun", ["run", "src/index-aisdk.ts"], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: process.cwd(),
});

// Read agent output
const agentOutput = createInterface({ input: agent.stdout! });
agentOutput.on("line", (line) => {
  try {
    const output = JSON.parse(line);
    // Format based on AI SDK part types
    switch (output.type) {
      case "ready":
        console.log(`\n✅ Agent ready (session: ${output.sessionId})`);
        break;
      case "text-delta":
        process.stdout.write(output.textDelta);
        break;
      case "tool-call":
        console.log(`\n🔧 Tool call: ${output.toolName}(${JSON.stringify(output.args)})`);
        break;
      case "tool-result": {
        const result = typeof output.result === "string"
          ? output.result.slice(0, 200) + (output.result.length > 200 ? "..." : "")
          : JSON.stringify(output.result).slice(0, 200);
        console.log(`\n📋 Tool result: ${result}`);
        break;
      }
      case "finish":
        console.log(`\n✔ Finished (${output.finishReason})`);
        if (output.usage) {
          console.log(`  Tokens: ${output.usage.promptTokens} prompt, ${output.usage.completionTokens} completion`);
        }
        break;
      case "error":
        console.log(`\n❌ Error: ${output.error}`);
        break;
      default:
        console.log("\n📤 Output:", JSON.stringify(output, null, 2));
    }
  } catch {
    console.log("\n📤 Raw output (unhandled):", line);
  }
});

// Read user input
const userInput = createInterface({ input: process.stdin, output: process.stdout });

console.log("Type a message to send to the agent. Ctrl+C to exit.\n");

userInput.on("line", (line) => {
  if (line === "/cancel") {
    const message = encodeAgentInput({ type: "cancel" });
    console.log(`\n⏹ Cancelling...`);
    agent.stdin!.write(message + "\n");
    return;
  }

  const message = encodeAgentInput({ type: "chat", message: { content: line } });
  console.log(`\n📥 Sending: ${line}`);
  agent.stdin!.write(message + "\n");
});

agent.on("exit", (code) => {
  console.log(`\nAgent exited with code ${code}`);
  process.exit(code ?? 0);
});
