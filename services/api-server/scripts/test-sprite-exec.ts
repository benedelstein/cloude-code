/**
 * Live smoke test for WebSocket command execution through the official Sprites Node SDK.
 *
 * Usage:
 *   cd services/api-server
 *   node --import tsx scripts/test-sprite-exec.ts <sprite-name> [command] [--cwd=/path] [--env=KEY=value]
 *
 * Examples:
 *   node --import tsx scripts/test-sprite-exec.ts my-sprite 'echo out; echo err >&2; exit 7'
 *   node --import tsx scripts/test-sprite-exec.ts my-sprite 'pwd' --cwd=/home/sprite/workspace
 */
import dotenv from "dotenv";
import { ExecError, SpritesClient } from "@fly/sprites";

dotenv.config({
  path: [".env.local", "../../scripts/.env", "../../.env"],
  quiet: true,
});

const SPRITES_API_KEY = process.env.SPRITES_API_KEY;
const SPRITES_API_URL = process.env.SPRITES_API_URL ?? "https://api.sprites.dev";

const spriteName = process.argv[2];
const command = process.argv[3] ?? "echo stdout; echo stderr >&2; exit 7";
const cwd = readOption("--cwd");
const env = readEnvOptions();

if (!SPRITES_API_KEY) {
  console.error("Missing SPRITES_API_KEY env var");
  process.exit(1);
}

if (!spriteName) {
  console.error(
    "Usage: node --import tsx scripts/test-sprite-exec.ts <sprite-name> [command] [--cwd=/path] [--env=KEY=value]",
  );
  process.exit(1);
}

const client = new SpritesClient(SPRITES_API_KEY, { baseURL: SPRITES_API_URL });
const sprite = client.sprite(spriteName);

const startedAt = Date.now();
console.log(`Sprite: ${spriteName}`);
console.log(`API: ${SPRITES_API_URL}`);
console.log(`Command: ${command}`);
if (cwd) {
  console.log(`cwd: ${cwd}`);
}
if (Object.keys(env).length > 0) {
  console.log(`env keys: ${Object.keys(env).join(", ")}`);
}

let result;
try {
  result = await sprite.execFile("sh", ["-c", command], { cwd, env });
} catch (error) {
  if (!(error instanceof ExecError)) {
    throw error;
  }
  result = error.result;
}

console.log(`durationMs: ${Date.now() - startedAt}`);
console.log(`exitCode: ${result.exitCode}`);
console.log(`stdout: ${JSON.stringify(result.stdout)}`);
console.log(`stderr: ${JSON.stringify(result.stderr)}`);

function readOption(name: string): string | undefined {
  const prefix = `${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function readEnvOptions(): Record<string, string> {
  const values: Record<string, string> = {};

  for (const arg of process.argv) {
    if (!arg.startsWith("--env=")) {
      continue;
    }
    const assignment = arg.slice("--env=".length);
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid --env option: ${arg}`);
    }
    values[assignment.slice(0, separatorIndex)] = assignment.slice(
      separatorIndex + 1,
    );
  }

  return values;
}
