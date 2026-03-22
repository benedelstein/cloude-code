/**
 * VM-agent entry point. Parses --provider flag and delegates to the agent harness.
 */
import { parseArgs } from "util";
import { AgentSettings } from "@repo/shared";
import { runAgentHarness } from "./agent-harness";
import { claudeCodeProvider } from "./providers/claude-code";
import { codexProvider } from "./providers/codex";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
  },
  strict: false,
});

if (typeof values.provider !== "string") {
  throw new Error("Missing --provider flag");
}

const settings = AgentSettings.parse(JSON.parse(values.provider));

switch (settings.provider) {
  case "claude-code":
    runAgentHarness(claudeCodeProvider, settings);
    break;
  case "codex-cli":
    runAgentHarness(codexProvider, settings);
    break;
}
