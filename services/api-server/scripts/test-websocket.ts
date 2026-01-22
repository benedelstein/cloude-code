#!/usr/bin/env npx tsx

import "dotenv/config";
import WebSocket from "ws";

const SPRITES_API_KEY = process.env.SPRITES_API_KEY!;
const SPRITE_NAME = process.argv[2] || "test-1768976896129";

const url = `wss://api.sprites.dev/v1/sprites/${SPRITE_NAME}/exec?cmd=/bin/bash&tty=true&cols=80&rows=24`;

console.error("Connecting to:", url);

type SessionInfoMessage = {
  type: "session_info";
  session_id: number;
  command: string;
  created: number;
  tty: boolean;
  cols: number;
  rows: number;
}





// --------------------------
// --------------------------
// --------------------------
// MARK: - API IMPLEMENTATION USING WS

let sessionId: number | null = null;

// const ws = new WebSocket(url, {
//   headers: {
//     Authorization: `Bearer ${SPRITES_API_KEY}`,
//   },
// });

// ws.on("open", () => {
//   console.log("[connected]");
//   console.log("ws opened");

//   // Set up stdin -> websocket
//   // process.stdin.setRawMode?.(true);
//   process.stdin.resume();
//   // send user keypresses to the websocket
//   process.stdin.on("data", (data) => {
//     ws.send(data);
//   });
// });

// ws.on("message", (data: WebSocket.RawData) => {
//   let str: string;
//   console.log(`[message] ${data}`);
//   if (Buffer.isBuffer(data)) {
//     str = data.toString("utf8");
//   } else if (data instanceof ArrayBuffer) {
//     str = Buffer.from(data).toString("utf8");
//   } else {
//     str = Buffer.concat(data as Buffer[]).toString("utf8");
//   }

//   // Check if JSON control message
//   if (str.startsWith("{")) {
//     try {
//       const json = JSON.parse(str);
//       if (json.type === "exit") {
//         console.log("\n[exit]", json.exit_code);
//         process.exit(json.exit_code);
//       } else if(json.type === "session_info") {
//         const sessionInfo = json as SessionInfoMessage;
//         console.log("[ctrl]", JSON.stringify(sessionInfo));
//         sessionId = sessionInfo.session_id;
//       }
//       return;
//     } catch {}
//   }

//   // Terminal output - write directly to stdout
//   process.stdout.write(str);
// });

// ws.on("close", (code, reason) => {
//   console.error(`\n[closed] code=${code}`);
//   process.exit(0);
// });

// ws.on("error", (err) => {
//   console.error("[error]", err.message);
//   process.exit(1);
// });


// process.on("SIGINT", async () => {
//   console.log("[SIGINT]");
//   if (sessionId) {
//     console.log("[SIGINT] sessionId", sessionId);
//     const response = await fetch(`https://api.sprites.dev/v1/sprites/${SPRITE_NAME}/exec/${sessionId}/kill`, {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${SPRITES_API_KEY}`,
//       },
//     });
//     if (response.ok) {
//       console.log("[SIGINT] session killed");
//     } else {
//       console.error("[SIGINT] failed to kill session", response.statusText);
//     }
//   }
//   process.exit(0);
// });