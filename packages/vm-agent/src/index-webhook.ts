/**
 * Webhook-mode vm-agent entrypoint. The process is spawned fresh per turn
 * with the initial user message encoded in CLI args; chunk/event delivery
 * back to the DO flows via HTTPS webhooks.
 */
import { parseArgs } from "util";
import {
  AgentInputMessage,
  AgentSettings,
  type AgentMode,
} from "@repo/shared";
import { type AgentProviderConfig } from "./lib/agent-harness";
import { claudeCodeProvider } from "./providers/claude-code";
import { codexProvider } from "./providers/codex";
import { WebhookAgentRunner } from "./webhook-agent-runner";

// The api-server spawns us with stdout/stderr already redirected to a file on
// the sprite (~/.cloude/logs/<sessionId>.log), so plain console.log is safe —
// file writes don't block on missing readers.
function consoleLogger(
  level: "debug" | "warn",
  message: string,
  meta?: unknown,
): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  if (level === "warn") {
    console.warn(line, meta ?? "");
  } else {
    console.log(line, meta ?? "");
  }
}

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    sessionId: { type: "string", short: "s" },
    agentMode: { type: "string" },
    initialMessage: { type: "string" },
    userMessageId: { type: "string" },
    model: { type: "string" },
  },
  strict: false,
});

function requireString(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${name} flag`);
  }
  return value;
}

const settings = AgentSettings.parse(JSON.parse(requireString("provider", values.provider)));
const userMessageId = requireString("userMessageId", values.userMessageId);
const initialMessage = AgentInputMessage.parse(
  JSON.parse(requireString("initialMessage", values.initialMessage)),
);

const webhookUrl = process.env.DO_WEBHOOK_URL;
const webhookToken = process.env.DO_WEBHOOK_TOKEN;
if (!webhookUrl) throw new Error("Missing DO_WEBHOOK_URL env var");
if (!webhookToken) throw new Error("Missing DO_WEBHOOK_TOKEN env var");

const args = {
  sessionId: typeof values.sessionId === "string" ? values.sessionId : undefined,
};
const initialAgentMode: AgentMode = values.agentMode === "plan" ? "plan" : "edit";
const idleTimeoutMs = process.env.IDLE_TIMEOUT_MS
  ? Number(process.env.IDLE_TIMEOUT_MS)
  : undefined;
const batchMaxChunks = process.env.BATCH_MAX_CHUNKS
  ? Number(process.env.BATCH_MAX_CHUNKS)
  : undefined;
const batchMaxAgeMs = process.env.BATCH_MAX_AGE_MS
  ? Number(process.env.BATCH_MAX_AGE_MS)
  : undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providerConfig: AgentProviderConfig<any> =
  settings.provider === "claude-code" ? claudeCodeProvider : codexProvider;

const runner = new WebhookAgentRunner({
  config: providerConfig,
  settings,
  webhookUrl,
  webhookToken,
  args,
  initialAgentMode,
  idleTimeoutMs,
  batchMaxChunks,
  batchMaxAgeMs,
  logger: consoleLogger,
});

// Kick off the initial turn immediately. The runner converts overrides into
// a harness modelId / agentMode switch before dispatching.
runner.queueMessage(userMessageId, initialMessage, {
  model: typeof values.model === "string" ? values.model : undefined,
  agentMode: values.agentMode === "plan" ? "plan" : undefined,
});
