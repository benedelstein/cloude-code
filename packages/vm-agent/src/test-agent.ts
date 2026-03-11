import { spawn } from "child_process";
import { createInterface } from "readline";
import { encodeAgentInput } from "@repo/shared";

console.log("🤖 vm-agent test harness");
// Spawn the agent process
const agent = spawn("bun", ["run", "src/index.ts"], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: process.cwd(),
});

// Read agent output
const agentOutput = createInterface({ input: agent.stdout! });
agentOutput.on("line", (line) => {
  try {
    const output = JSON.parse(line);
    console.log("\n📤 Agent output:", JSON.stringify(output, null, 2));
  } catch {
    console.log("\n📤 Raw output:", line);
  }
});

// Read user input
const userInput = createInterface({ input: process.stdin, output: process.stdout });

console.log("🤖 vm-agent test harness");
console.log("Type a message to send to the agent. Ctrl+C to exit.\n");

userInput.on("line", (line) => {
  const message = encodeAgentInput({ type: "chat", message: { content: line } });
  console.log(`\n📥 Sending: ${message}`);
  agent.stdin!.write(message + "\n");
});

agent.on("exit", (code) => {
  console.log(`\nAgent exited with code ${code}`);
  process.exit(code ?? 0);
});
