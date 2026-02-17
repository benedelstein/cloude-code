// Test script for Sprites HTTP exec via WorkersSprite — verifies binary protocol parsing.
// Usage: npx tsx scripts/test-sprite-exec.ts <sprite-name> [command]
// Default command: "echo hello && exit 1"

import dotenv from "dotenv";
import { WorkersSprite } from "../src/lib/sprites/WorkersSprite";

dotenv.config({ path: ".env.local" });

const SPRITES_API_KEY = process.env.SPRITES_API_KEY;
const SPRITES_API_URL = process.env.SPRITES_API_URL ?? "https://api.sprites.dev";

if (!SPRITES_API_KEY) {
  console.error("Error: SPRITES_API_KEY environment variable is required");
  process.exit(1);
}

const spriteName = process.argv[2];
const command = process.argv[3] || "echo hello && exit 1";

if (!spriteName) {
  console.error("Usage: npx tsx scripts/test-sprite-exec.ts <sprite-name> [command]");
  process.exit(1);
}

const sprite = new WorkersSprite(spriteName, SPRITES_API_KEY, SPRITES_API_URL);

async function runTest(label: string, cmd: string) {
  console.log(`\n--- ${label}: ${cmd}`);
  try {
    const result = await sprite.execHttp(cmd);
    console.log(`exitCode: ${result.exitCode}`);
    console.log(`stdout: ${JSON.stringify(result.stdout)}`);
    console.log(`stderr: ${JSON.stringify(result.stderr)}`);
  } catch (error) {
    console.error(`Error:`, error);
  }
}

await runTest("Custom command", command);
await runTest("Exit code 42", "exit 42");
await runTest("Stdout + stderr", "echo out && echo err >&2");
await runTest("Failing git clone", "git clone https://x-access-token:INVALID@github.com/test/nonexistent.git /tmp/test-clone");

export {};
