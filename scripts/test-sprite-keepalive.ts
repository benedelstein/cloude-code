/**
 * Minimal repro for the "process suspends after ws disconnect" question.
 *
 * What it does:
 *   1. Opens an exec websocket on an existing sprite that runs a shell loop
 *      writing a timestamped line to a file every second.
 *   2. Waits for the `session_info` frame so we know the process is up.
 *   3. Closes the websocket and exits.
 *
 * What you do:
 *   - Wait some amount of time (say, 30s).
 *   - SSH to the sprite (or `sprite c` and start a fresh shell — do NOT attach
 *     to the test session id) and inspect the log file:
 *       cat /tmp/sprite-keepalive-test.log
 *   - If the line count matches elapsed-seconds, the process kept running while
 *     detached. If it stalled or only has a couple of lines, the process was
 *     suspended along with the sprite.
 *
 * Usage:
 *   tsx scripts/test-sprite-keepalive.ts <sprite-name> [tty=true|false] [detachable=true|false] [maxRunAfterDisconnect=6h] [extraActivity=none|curl] [command=sh|python|sh-exec-python|bun|bun-codex]
 *
 * Env: SPRITES_API_KEY (loaded from .env via dotenv)
 */
import "dotenv/config";
// Use Node's native WebSocket (Node 22+), same as the @fly/sprites SDK.
// The `ws` package sends keepalive pings and graceful close frames that may
// differ from native behavior on disconnect.

const SPRITES_API_KEY = process.env.SPRITES_API_KEY;
if (!SPRITES_API_KEY) {
  console.error("Missing SPRITES_API_KEY env var");
  process.exit(1);
}

const spriteName = process.argv[2];
if (!spriteName) {
  console.error(
    "Usage: tsx scripts/test-sprite-keepalive.ts <sprite-name> [tty=true|false] [detachable=true|false] [maxRunAfterDisconnect=6h] [extraActivity=none|curl] [command=sh|python|sh-exec-python|bun|bun-codex]",
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

const tty = options.get("tty") === "true";
const detachable = options.get("detachable") === "true";
const maxRunArg =
  options.get("maxRunAfterDisconnect") ?? options.get("max_run_after_disconnect");
// 4th arg: extraActivity={none|curl}
//   - none: just timestamp + sleep (default)
//   - curl: also do a brief outbound HTTPS curl every iteration; tests whether
//     "Open TCP connections" activity signal keeps the sprite running.
const extraActivityArg = options.get("extraActivity") ?? "none";
const extraCmd = extraActivityArg === "curl"
  ? "curl -s -o /dev/null https://example.com;"
  : "";
const commandArg = options.get("command") ?? "sh";

const LOG_PATH = "/tmp/sprite-keepalive-test.log";
const SHELL_LOOP = `
rm -f ${LOG_PATH};
i=0;
while true; do
  ${extraCmd}
  echo "[$(date -Iseconds)] tick $i" >> ${LOG_PATH};
  i=$((i+1));
  sleep 1;
done
`.trim();

const PYTHON_SCRIPT = `
import time, datetime
print('Server ready', flush=True)
with open('${LOG_PATH}', 'w') as f:
    f.write('start ' + datetime.datetime.now().isoformat() + '\\n')
time.sleep(30)
with open('${LOG_PATH}', 'a') as f:
    f.write('end   ' + datetime.datetime.now().isoformat() + '\\n')
`;

const BUN_SCRIPT = `
const logPath = "${LOG_PATH}";
console.log("Server ready");
await Bun.write(logPath, "start " + new Date().toISOString() + "\\n");
await Bun.sleep(30_000);
await Bun.write(logPath, await Bun.file(logPath).text() + "end   " + new Date().toISOString() + "\\n");
`;

const BUN_CODEX_SCRIPT = `
const logPath = "${LOG_PATH}";
const append = async (line) => {
  const existing = await Bun.file(logPath).exists() ? await Bun.file(logPath).text() : "";
  await Bun.write(logPath, existing + "[" + new Date().toISOString() + "] " + line + "\\n");
};

console.log("Server ready");
await Bun.write(logPath, "[" + new Date().toISOString() + "] start bun codex exec\\n");

const child = Bun.spawn(["codex", "exec", "whats in this folder?", "--skip-git-repo-check"], {
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);

await append("codex exit " + exitCode);
if (stdout.length > 0) await append("stdout " + JSON.stringify(stdout));
if (stderr.length > 0) await append("stderr " + JSON.stringify(stderr));
await append("end bun codex exec");
`;

const url = new URL(`wss://api.sprites.dev/v1/sprites/${spriteName}/exec`);
switch (commandArg) {
  case "sh":
    url.searchParams.set("path", "sh");
    url.searchParams.append("cmd", "sh");
    url.searchParams.append("cmd", "-c");
    url.searchParams.append("cmd", SHELL_LOOP);
    break;
  case "python":
    url.searchParams.set("path", "python3");
    url.searchParams.append("cmd", "python3");
    url.searchParams.append("cmd", "-c");
    url.searchParams.append("cmd", PYTHON_SCRIPT);
    break;
  case "sh-exec-python":
    url.searchParams.set("path", "sh");
    url.searchParams.append("cmd", "sh");
    url.searchParams.append("cmd", "-c");
    url.searchParams.append("cmd", 'exec python3 -c "$1"');
    url.searchParams.append("cmd", "python-keepalive-test");
    url.searchParams.append("cmd", PYTHON_SCRIPT);
    break;
  case "bun":
    url.searchParams.set("path", "bun");
    url.searchParams.append("cmd", "bun");
    url.searchParams.append("cmd", "-e");
    url.searchParams.append("cmd", BUN_SCRIPT);
    break;
  case "bun-codex":
    url.searchParams.set("path", "bun");
    url.searchParams.append("cmd", "bun");
    url.searchParams.append("cmd", "-e");
    url.searchParams.append("cmd", BUN_CODEX_SCRIPT);
    break;
  default:
    console.error(`Unsupported command: ${commandArg}`);
    process.exit(1);
}
if (tty) url.searchParams.set("tty", "true");
if (detachable) url.searchParams.set("detachable", "true");
// SDK behavior: always enable stdin. Without this the sprite may not
// register the session as fully attached.
url.searchParams.set("stdin", "true");
// Only set max_run_after_disconnect if user explicitly passed something other
// than the default; passing it alongside detachable seems to override tmux
// keep-running behavior.
if (maxRunArg) {
  url.searchParams.set("max_run_after_disconnect", maxRunArg);
}

console.log("Connecting:", url.toString());
console.log("  tty:", tty);
console.log("  detachable:", detachable);
console.log(
  "  max_run_after_disconnect:",
  maxRunArg ?? "(omitted; sprite default)",
);
console.log("  extraActivity:", extraActivityArg);
console.log("  command:", commandArg);
console.log("  log path on sprite:", LOG_PATH);

// Node's native WebSocket accepts an options object with headers as a
// non-standard extension (the WHATWG spec only takes a protocols arg).
const ws = new WebSocket(url.toString(), {
  // @ts-expect-error — headers is a Node extension not in WHATWG spec
  headers: { Authorization: `Bearer ${SPRITES_API_KEY}` },
});

ws.addEventListener("open", () => {
  console.log("ws open");
});

ws.addEventListener("message", (event) => {
  // Native WebSocket: data is string (text) or ArrayBuffer (binary)
  if (typeof event.data !== "string") {
    // Binary frames are stdio multiplex — ignore for this test.
    return;
  }
  const text = event.data;
  try {
    const msg = JSON.parse(text) as { type?: string; session_id?: number };
    if (msg.type === "session_info") {
      console.log("session_info:", msg);
      console.log(`process spawned, session_id=${msg.session_id}`);
      console.log("exiting in 500ms (NO graceful ws close — mimics SDK)...");
      setTimeout(() => {
        // Mimic SDK's `process.exit(0)` — abrupt TCP close, no close frame.
        // Sprite may treat ws.close(1000) as "client done, tear down session"
        // but treat kernel-level disconnect as "keep alive per detachable".
        process.exit(0);
      }, 500);
    } else {
      console.log("server msg:", msg);
    }
  } catch {
    console.log("server text frame:", text);
  }
});

ws.addEventListener("close", (event) => {
  console.log("ws closed", { code: event.code, reason: event.reason });
  console.log();
  console.log("Now wait ~30s, then on the sprite run:");
  console.log(`  cat ${LOG_PATH}`);
  console.log(
    "If line count == elapsed seconds, process kept running detached. If stalled, sprite suspended it.",
  );
  process.exit(0);
});

ws.addEventListener("error", (event) => {
  console.error("ws error:", event);
  process.exit(1);
});
