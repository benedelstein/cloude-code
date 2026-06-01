/**
 * Live smoke test for WorkersSpriteClient generic exec.
 *
 * Usage:
 *   cd services/api-server
 *   node --import tsx scripts/test-workers-sprite-client.ts <sprite-name> [command] [--cwd=/path] [--env=KEY=value]
 *
 * Examples:
 *   node --import tsx scripts/test-workers-sprite-client.ts my-sprite 'echo out; echo err >&2; exit 7'
 *   node --import tsx scripts/test-workers-sprite-client.ts my-sprite 'pwd' --cwd=/home/sprite/workspace
 */
import dotenv from "dotenv";
import { WorkersSpriteClient } from "../src/shared/integrations/sprites/WorkersSpriteClient";

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
    "Usage: node --import tsx scripts/test-workers-sprite-client.ts <sprite-name> [command] [--cwd=/path] [--env=KEY=value]",
  );
  process.exit(1);
}

const sprite = new WorkersSpriteClient(
  spriteName,
  SPRITES_API_KEY,
  SPRITES_API_URL,
);

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

const result = await sprite.execHttp(command, {
  dir: cwd,
  env,
});

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
