/**
 * Legacy stdio entrypoint. Wires stdin/stdout to the agent harness handle so
 * the existing workflow-based path keeps functioning while the webhook
 * migration lands. New deployments should prefer index-webhook.ts.
 */
import { parseArgs } from "util";
import { createInterface } from "readline";
import {
  AgentSettings,
  AgentMode,
  type AgentOutput,
  decodeAgentInput,
  encodeAgentOutput,
} from "@repo/shared";
import { startAgentHarness, type AgentProviderConfig } from "./lib/agent-harness";
import { claudeCodeProvider } from "./providers/claude-code";
import { codexProvider } from "./providers/codex";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    sessionId: { type: "string", short: "s" },
    agentMode: { type: "string" },
  },
  strict: false,
});

if (typeof values.provider !== "string") {
  throw new Error("Missing --provider flag");
}

const settings = AgentSettings.parse(JSON.parse(values.provider));
const args = {
  sessionId: typeof values.sessionId === "string" ? values.sessionId : undefined,
};
const initialAgentMode: AgentMode = values.agentMode ? AgentMode.parse(values.agentMode) : "edit";

function emit(output: AgentOutput): void {
  process.stdout.write(encodeAgentOutput(output) + "\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providerConfig: AgentProviderConfig<any> = (() => {
  switch (settings.provider) {
    case "claude-code":
      return claudeCodeProvider;
    case "openai-codex":
      return codexProvider;
    default: {
      const _exhaustiveCheck: never = settings;
      throw new Error(`Unhandled provider: ${_exhaustiveCheck}`);
    }
  }
})();

const handle = startAgentHarness({
  config: providerConfig,
  settings,
  emit,
  args,
  initialAgentMode,
});

const rl = createInterface({ input: process.stdin });
rl.on("line", (rawLine) => {
  const line = rawLine.charCodeAt(0) === 0 ? rawLine.slice(1) : rawLine;

  try {
    const input = decodeAgentInput(line);
    switch (input.type) {
      case "chat":
        handle.queueMessage(input.message, {
          model: input.model,
          agentMode: input.agentMode,
        });
        break;
      case "cancel":
        emit({ type: "debug", message: "cancel received; aborting current operation" });
        handle.cancel();
        break;
    }
  } catch (e) {
    emit({ type: "error", error: `Invalid input: ${e}` });
  }
});

process.stdin.resume();
