// Test script for the native @fly/sprites SDK - interactive shell via websocket

import { SpritesClient } from "@fly/sprites";
import dotenv from "dotenv";

dotenv.config();

const SPRITES_TOKEN = process.env.SPRITES_API_KEY;
const SPRITES_API_URL = process.env.SPRITES_API_URL ?? "https://api.sprites.dev";

if (!SPRITES_TOKEN) {
  console.error("Error: SPRITES_API_KEY environment variable is required");
  process.exit(1);
}

async function main() {
  const token = SPRITES_TOKEN as string;
  const spriteName = process.argv[2] ?? "test-1768976896129";

  console.error(`Connecting to sprite: ${spriteName}`);
  console.error(`API URL: ${SPRITES_API_URL}\n`);

  const client = new SpritesClient(token, { baseURL: SPRITES_API_URL });
  const sprite = client.sprite(spriteName);

  // Spawn interactive bash with TTY
  const cmd = sprite.spawn("claude", [], {
    cwd: "/home/sprite/workspace",
    tty: true,
    cols: 80,
    rows: 24,
  });

  cmd.on("spawn", () => {
    console.log("[connected]");

    // Set up stdin -> sprite
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on("data", (data) => {
      cmd.stdin.write(data);
    });
  });

  cmd.on("message", (msg: unknown) => {
    console.log("[receivedmessage]", JSON.stringify(msg));
  });

  // Sprite stdout -> terminal
  cmd.stdout.on("data", (data: Buffer) => {
    process.stdout.write(data);
  });

  // Sprite stderr -> terminal
  cmd.stderr.on("data", (data: Buffer) => {
    process.stderr.write(data);
  });

  cmd.on("exit", (code: number) => {
    console.log(`\n[exit] code=${code}`);
    process.exit(code);
  });

  cmd.on("error", (err: Error) => {
    console.error("[error]", err.message);
    process.exit(1);
  });

  // Handle SIGINT
  process.on("SIGINT", () => {
    // Forward Ctrl+C to the remote shell
    cmd.stdin.write("\x03");
  });

  // Handle terminal resize
  if (process.stdout.isTTY) {
    process.stdout.on("resize", () => {
      console.log("[resize]", process.stdout.columns, process.stdout.rows);
      cmd.resize(process.stdout.columns, process.stdout.rows);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
