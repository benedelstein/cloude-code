/**
 * Local test harness for the webhook-mode vm-agent.
 *
 * Boots a tiny Bun HTTP server that plays the role of the DO's webhook
 * endpoints (/chunks and /events), spawns the webhook entrypoint pointed at
 * it, and renders incoming batches to the console in real time.
 *
 * Usage:
 *   cd packages/vm-agent
 *   bun run src/test-webhook-runner.ts -p claude-code -m opus
 *   bun run src/test-webhook-runner.ts -p openai-codex -m gpt-5.3-codex
 *
 * The process exits when the vm-agent exits (either because its idle timer
 * fired, or because you ^C).
 */
import { spawn } from "child_process";
import { parseArgs } from "util";
import { randomUUID } from "crypto";
import {
  CLAUDE_PROVIDER,
  MessageAccumulator,
  OPENAI_CODEX_PROVIDER_ID,
  type AgentOutput,
  type UIMessageChunk,
} from "@repo/shared";

const { values, positionals } = parseArgs({
  options: {
    provider: { type: "string", short: "p", default: "openai-codex" },
    model: { type: "string", short: "m" },
    sessionId: { type: "string", short: "s" },
    port: { type: "string", default: "0" },
    prompt: { type: "string" },
  },
  strict: false,
  allowPositionals: true,
});

const provider = String(values.provider ?? OPENAI_CODEX_PROVIDER_ID);
const defaultModel = provider === "openai-codex" ? "gpt-5.3-codex" : "opus";
const model = String(values.model ?? defaultModel);
const sessionId = values.sessionId ? String(values.sessionId) : undefined;
const requestedPort = Number(values.port ?? 0);

const prompt = (typeof values.prompt === "string" && values.prompt.length > 0)
  ? values.prompt
  : positionals.length > 0
    ? positionals.join(" ")
    : "say hi in one short sentence, then finish.";

const userMessageId = `local-${randomUUID()}`;
const webhookToken = `local-token-${randomUUID()}`;

const turnStart = Date.now();
const elapsed = () => `+${String(Date.now() - turnStart).padStart(5, " ")}ms`;
const log = (tag: string, ...rest: unknown[]) => console.log(`[${elapsed()}] ${tag}`, ...rest);

const accumulator = new MessageAccumulator();

interface ChunkBatchItem {
  sequence: number;
  chunk: UIMessageChunk;
}

// Spin up the mock DO endpoint.
const server = Bun.serve({
  port: requestedPort,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${webhookToken}`) {
      log("HTTP-401", url.pathname, "bad bearer token");
      return new Response("unauthorized", { status: 401 });
    }

    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    try {
      if (url.pathname === "/chunks") {
        const body = (await req.json()) as {
          userMessageId: string;
          chunks: ChunkBatchItem[];
        };
        log(
          "CHUNKS",
          `userMessageId=${body.userMessageId} size=${body.chunks.length}`,
        );
        for (const { sequence, chunk } of body.chunks) {
          const { finishedMessage } = accumulator.process(chunk);
          if (chunk.type === "text-delta") {
            log(
              "text-delta",
              `#${sequence} ${JSON.stringify((chunk as { delta?: string }).delta ?? "")}`,
            );
          } else if (chunk.type === "finish") {
            log(
              "FINISH",
              `#${sequence} reason=${(chunk as { finishReason?: string }).finishReason}`,
            );
          } else {
            log("chunk", `#${sequence} ${chunk.type}`);
          }
          if (finishedMessage) {
            log("finishedMessage", JSON.stringify(finishedMessage).slice(0, 200) + " ...");
            accumulator.reset();
          }
        }
        return new Response("", { status: 204 });
      }

      if (url.pathname === "/events") {
        const body = (await req.json()) as { event: AgentOutput };
        const event = body.event;
        switch (event.type) {
          case "ready":
            log("ready", "vm-agent ready");
            break;
          case "debug":
            log("debug", event.message);
            break;
          case "error":
            log("error", event.error);
            break;
          case "sessionId":
            log("SESSION-ID", event.sessionId);
            break;
          case "heartbeat":
            log("heartbeat");
            break;
          case "stream":
            log("stream-on-/events", "unexpected — should be on /chunks");
            break;
          default:
            log("event", JSON.stringify(event));
        }
        return new Response("", { status: 204 });
      }

      log("HTTP-404", url.pathname);
      return new Response("not found", { status: 404 });
    } catch (error) {
      log("HTTP-500", url.pathname, String(error));
      return new Response("error", { status: 500 });
    }
  },
});

const baseUrl = `http://127.0.0.1:${server.port}`;
console.log(`mock DO listening at ${baseUrl}`);
console.log(`  provider=${provider} model=${model}${sessionId ? ` sessionId=${sessionId}` : ""}`);
console.log(`  prompt: ${JSON.stringify(prompt)}`);
console.log();

// Make sure CLAUDE_PROVIDER is referenced so the import isn't dropped — we
// use its models list only when the user explicitly asks for claude-code.
void CLAUDE_PROVIDER;

const settingsJson = JSON.stringify({ provider, model });
const initialMessageJson = JSON.stringify({ content: prompt });

const spawnArgs = [
  "run",
  "src/index-webhook.ts",
  "--provider",
  settingsJson,
  "--initialMessage",
  initialMessageJson,
  "--userMessageId",
  userMessageId,
];
if (sessionId) {
  spawnArgs.push("--sessionId", sessionId);
}

const agent = spawn("bun", spawnArgs, {
  stdio: ["pipe", "inherit", "inherit"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    VM_AGENT_LOCAL: "1",
    DO_WEBHOOK_URL: baseUrl,
    DO_WEBHOOK_TOKEN: webhookToken,
    // Short idle timeout so the process exits quickly after the turn ends.
    IDLE_TIMEOUT_MS: process.env.IDLE_TIMEOUT_MS ?? "3000",
  },
});

agent.on("exit", (code) => {
  console.log(`\nvm-agent exited with code ${code}`);
  server.stop();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  console.log("\n^C — killing agent");
  agent.kill("SIGINT");
});
