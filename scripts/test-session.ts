import dotenv from "dotenv";
import WebSocket from "ws";
import * as readline from "readline";

dotenv.config();

const API_URL = process.env.API_URL ?? "http://localhost:8787";

interface SessionResponse {
  sessionId: string;
  wsUrl: string;
}

async function createSession(repoId: string): Promise<SessionResponse> {
  const res = await fetch(`${API_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to create session: ${res.status} ${error}`);
  }

  return res.json() as Promise<SessionResponse>;
}

async function getSession(sessionId: string): Promise<SessionResponse> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}`);

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to get session: ${res.status} ${error}`);
  }

  return res.json() as Promise<SessionResponse>;
}

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function connectWebSocket(wsUrl: string): WebSocket {
  console.log(`\nConnecting to WebSocket: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("[WS] Connected\n");
  });

  ws.on("message", (data: WebSocket.Data) => {
    const msg = JSON.parse(data.toString());
    console.log(`[WS] ${msg.type}:`, JSON.stringify(msg, null, 2));
  });

  ws.on("close", (code: number, reason: Buffer) => {
    console.log(`[WS] Closed: ${code} ${reason.toString()}`);
    process.exit(0);
  });

  ws.on("error", (err: Error) => {
    console.error("[WS] Error:", err);
  });

  return ws;
}

function setupRepl(ws: WebSocket) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Commands:");
  console.log("  <message>  - Send a chat message");
  console.log("  /quit      - Exit\n");

  rl.on("line", (line) => {
    const input = line.trim();
    if (!input) return;

    if (input === "/quit") {
      ws.close();
      rl.close();
      return;
    }

    // Send chat message
    ws.send(JSON.stringify({
      type: "chat.message",
      content: input,
    }));
  });

  rl.on("close", () => {
    ws.close();
    process.exit(0);
  });
}

async function main() {
  const arg = process.argv[2];
  console.log(`API URL: ${API_URL}\n`);

  let session: SessionResponse;

  if (arg) {
    if (!isUUID(arg)) {
      console.error(`Invalid session id: ${arg}`);
      process.exit(1);
    }
    // Resume existing session
    console.log(`Resuming session: ${arg}`);
    session = await getSession(arg);
    console.log("Session info:");
  } else {
    // Create new session
    const repoId = arg ?? "anthropics/claude-code";
    console.log(`Creating session for repo: ${repoId}`);
    session = await createSession(repoId);
    console.log("Session created:");
  }

  console.log(JSON.stringify(session, null, 2));

  const ws = connectWebSocket(session.wsUrl);

  ws.on("open", () => {
    setupRepl(ws);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
