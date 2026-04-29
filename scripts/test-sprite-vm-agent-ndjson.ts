/**
 * Live Sprites repro for launching the real ndjson vm-agent asynchronously.
 *
 * This uploads packages/vm-agent/dist/vm-agent.bundle.js to an existing sprite,
 * writes one encoded chat input line, and starts the bundle through a short
 * shell bootstrap that execs into bun. Output is redirected to a log file on
 * the sprite so the setup websocket can disconnect.
 *
 * Usage:
 *   tsx scripts/test-sprite-vm-agent-ndjson.ts <sprite-name> [provider=claude-code|openai-codex] [model=gpt-5.3-codex] [message="say hi"] [agentMode=edit]
 *
 * Env:
 *   SPRITES_API_KEY
 *   CLAUDE_CREDENTIALS_JSON  optional, required for provider=claude-code unless the sprite already has auth
 *   CODEX_AUTH_JSON          optional; defaults to local ~/.codex/auth.json for provider=openai-codex
 *   ANTHROPIC_API_KEY        optional, passed through for experiments but not consumed by the current claude-code provider
 */
import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { homedir } from "os";

const SPRITES_API_URL = process.env.SPRITES_API_URL ?? "https://api.sprites.dev";
const SPRITES_API_KEY = process.env.SPRITES_API_KEY;
if (!SPRITES_API_KEY) {
  console.error("Missing SPRITES_API_KEY env var");
  process.exit(1);
}

const spriteName = process.argv[2];
if (!spriteName) {
  console.error(
    'Usage: tsx scripts/test-sprite-vm-agent-ndjson.ts <sprite-name> [provider=claude-code|openai-codex] [model=gpt-5.3-codex] [message="say hi"] [agentMode=edit]',
  );
  process.exit(1);
}

const options = new Map(
  process.argv
    .slice(3)
    .map((arg) => {
      const [key, ...valueParts] = arg.split("=");
      return [key, valueParts.join("=")] as const;
    })
    .filter(([key, value]) => key.length > 0 && value.length > 0),
);

const provider = options.get("provider") ?? "openai-codex";
const model =
  options.get("model") ?? (provider === "openai-codex" ? "gpt-5.3-codex" : "sonnet");
const message = options.get("message") ?? "Say hello, then stop.";
const agentMode = options.get("agentMode") ?? "edit";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(scriptDir, "../packages/vm-agent/dist/vm-agent.bundle.js");
let bundle: string;
try {
  bundle = readFileSync(bundlePath, "utf8");
} catch {
  console.error(`Missing vm-agent bundle: ${bundlePath}`);
  console.error("Build it first with: pnpm --filter @repo/vm-agent build");
  process.exit(1);
}

const remoteDir = "/home/sprite/.cloude";
const remoteBundlePath = `${remoteDir}/vm-agent-ndjson.bundle.js`;
const remoteInputPath = `${remoteDir}/vm-agent-ndjson-input.jsonl`;
const remoteLogPath = `${remoteDir}/logs/vm-agent-ndjson-live-test.log`;
const providerSettings = JSON.stringify({ provider, model });
const inputLine =
  JSON.stringify({ type: "chat", message: { content: message }, agentMode }) + "\n";

async function writeFile(path: string, content: string, mode?: string): Promise<void> {
  const url = new URL(`${SPRITES_API_URL}/v1/sprites/${spriteName}/fs/write`);
  url.searchParams.set("path", path);
  url.searchParams.set("mkdir", "true");
  if (mode) url.searchParams.set("mode", mode);

  const response = await fetch(url.toString(), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${SPRITES_API_KEY}`,
      "Content-Type": "application/octet-stream",
    },
    body: content,
  });
  if (!response.ok) {
    throw new Error(`write ${path} failed: ${response.status} ${await response.text()}`);
  }
}

await writeFile(remoteBundlePath, bundle, "0755");
await writeFile(remoteInputPath, inputLine, "0600");
await writeFile(remoteLogPath, "", "0600");

const env: Record<string, string> = {
  SESSION_ID: "vm-agent-ndjson-live-test",
  VM_AGENT_LIVE_TEST: "1",
  VM_AGENT_HEARTBEAT_INTERVAL_MS: "30000",
};
for (const key of ["CLAUDE_CREDENTIALS_JSON", "CODEX_AUTH_JSON", "ANTHROPIC_API_KEY"] as const) {
  const value = process.env[key];
  if (value) env[key] = value;
}
if (provider === "openai-codex" && !env.CODEX_AUTH_JSON) {
  const codexAuthPath = resolve(homedir(), ".codex/auth.json");
  if (!existsSync(codexAuthPath)) {
    console.error(`Missing CODEX_AUTH_JSON and ${codexAuthPath} does not exist`);
    process.exit(1);
  }
  env.CODEX_AUTH_JSON = readFileSync(codexAuthPath, "utf8");
}

const url = new URL(`${SPRITES_API_URL}/v1/sprites/${spriteName}/exec`);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
url.searchParams.set("path", "sh");
url.searchParams.append("cmd", "sh");
url.searchParams.append("cmd", "-c");
const shellCommand = `mkdir -p ${remoteDir}/logs && bun "$@" < ${remoteInputPath} 2>&1 | while IFS= read -r line; do printf '[%s] %s\\n' "$(date -Iseconds)" "$line"; done | tee -a ${remoteLogPath}`;
url.searchParams.append(
  "cmd",
  shellCommand,
);
url.searchParams.append("cmd", "vm-agent-ndjson");
url.searchParams.append("cmd", remoteBundlePath);
url.searchParams.append("cmd", "--provider");
url.searchParams.append("cmd", providerSettings);
url.searchParams.append("cmd", "--agentMode");
url.searchParams.append("cmd", agentMode);
url.searchParams.set("tty", "true");
url.searchParams.set("detachable", "true");
url.searchParams.set("stdin", "true");
for (const [key, value] of Object.entries(env)) {
  url.searchParams.append("env", `${key}=${value}`);
}

console.log("Uploaded vm-agent ndjson bundle:", remoteBundlePath);
console.log("Uploaded input:", remoteInputPath);
console.log("Log path:", remoteLogPath);
console.log("Provider:", providerSettings);
console.log("Message:", message);
console.log("Log timestamps: true");
console.log("Stdout: tee");
console.log("Heartbeat ms: 30000");
console.log("Connecting:", url.toString());

const ws = new WebSocket(url.toString(), {
  // @ts-expect-error headers is a Node extension to WHATWG WebSocket.
  headers: { Authorization: `Bearer ${SPRITES_API_KEY}` },
});
ws.binaryType = "arraybuffer";

ws.addEventListener("open", () => {
  console.log("ws open");
});

ws.addEventListener("message", (event) => {
  if (typeof event.data !== "string") return;
  try {
    const message = JSON.parse(event.data) as { type?: string; session_id?: number };
    if (message.type === "session_info") {
      console.log("session_info:", message);
      console.log("exiting in 2s; inspect log on sprite after it runs:");
      console.log(`  cat ${remoteLogPath}`);
      setTimeout(() => process.exit(0), 2000);
    } else {
      console.log("server msg:", message);
    }
  } catch {
    console.log("server text frame:", event.data);
  }
});

ws.addEventListener("close", (event) => {
  console.log("ws closed", { code: event.code, reason: event.reason });
  process.exit(0);
});

ws.addEventListener("error", (event) => {
  console.error("ws error:", event);
  process.exit(1);
});
