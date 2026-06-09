/**
 * Reproduces Codex startup-toolchain HTTP exec result mismatches on a live Sprite.
 *
 * Usage:
 *   cd services/api-server
 *   pnpm test:live:codex-toolchain-http <sprite-name> --iterations=50
 *
 * Env:
 *   SPRITES_API_KEY required
 *   SPRITES_API_URL optional, defaults to https://api.sprites.dev
 *   CODEX_MIN_VERSION optional, defaults through the provider check contract
 */
import dotenv from "dotenv";
import type { Logger } from "@repo/shared";
import { getOpenAICodexStartupToolchainChecks } from "../src/shared/integrations/sprites/startup-toolchain/providers/openai-codex";

const DEFAULT_ITERATIONS = 50;
const DEFAULT_DELAY_MS = 0;
const MAX_OUTPUT_PREVIEW_LENGTH = 2000;
const RAW_TAIL_BYTES = 48;

type CliConfig = {
  spriteName: string;
  iterations: number;
  delayMs: number;
  minVersion?: string;
  continueOnAnomaly: boolean;
  verboseChunks: boolean;
  traceBashExit: boolean;
  xtrace: boolean;
  loginShell: boolean;
};

type ChunkSummary = {
  index: number;
  byteLength: number;
  firstByteHex: string | null;
  firstByteKind: string;
  tailExitCandidate: number | null;
  preview: string;
  hex: string;
};

type RawExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  contentType: string | null;
  contentLength: string | null;
  chunkCount: number;
  rawTailHex: string;
  chunks: ChunkSummary[];
};

type ExecHttpParseState = {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutDecoder: TextDecoder;
  stderrDecoder: TextDecoder;
};

dotenv.config({
  path: [".env.local", "../../scripts/.env", "../../.env"],
  quiet: true,
});

const config = parseCli(process.argv.slice(2));
const SPRITES_API_KEY = process.env.SPRITES_API_KEY;
const SPRITES_API_URL = process.env.SPRITES_API_URL ?? "https://api.sprites.dev";

if (!SPRITES_API_KEY) {
  console.error("Missing SPRITES_API_KEY env var");
  process.exit(1);
}

const baseStartupScript = getCodexStartupScript(config.minVersion ?? process.env.CODEX_MIN_VERSION);
const startupScript = [
  config.xtrace ? "set -x" : null,
  config.traceBashExit ? "trap 'echo bash_exit:$?' EXIT" : null,
  baseStartupScript,
].filter((part) => part !== null).join("\n");
const command = `bash ${config.loginShell ? "-lc" : "-c"} ${shellQuote(startupScript)}`;

console.error(`Sprite: ${config.spriteName}`);
console.error(`API: ${SPRITES_API_URL}`);
console.error(`Iterations: ${config.iterations}`);
console.error(`DelayMs: ${config.delayMs}`);
console.error(`ContinueOnAnomaly: ${config.continueOnAnomaly}`);
console.error(`VerboseChunks: ${config.verboseChunks}`);
console.error(`TraceBashExit: ${config.traceBashExit}`);
console.error(`Xtrace: ${config.xtrace}`);
console.error(`LoginShell: ${config.loginShell}`);
console.error(`Command: ${command.slice(0, 120)}...`);

let anomalyCount = 0;
for (let iteration = 1; iteration <= config.iterations; iteration += 1) {
  const result = await execHttpRaw({
    spriteName: config.spriteName,
    apiKey: SPRITES_API_KEY,
    baseUrl: SPRITES_API_URL,
    command,
  });
  const anomaly = classifyAnomaly(result);
  if (anomaly) {
    anomalyCount += 1;
  }

  console.log(JSON.stringify({
    type: "iteration",
    iteration,
    anomaly,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: truncateOutput(result.stdout),
    stderr: truncateOutput(result.stderr),
    chunkCount: result.chunkCount,
    contentType: result.contentType,
    contentLength: result.contentLength,
    rawTailHex: result.rawTailHex,
    chunkHeads: result.chunks.map((chunk) => ({
      index: chunk.index,
      byteLength: chunk.byteLength,
      firstByteHex: chunk.firstByteHex,
      firstByteKind: chunk.firstByteKind,
      tailExitCandidate: chunk.tailExitCandidate,
    })),
  }));

  if (anomaly || config.verboseChunks) {
    console.log(JSON.stringify({
      type: "chunks",
      iteration,
      chunks: result.chunks,
    }));
  }

  if (anomaly && !config.continueOnAnomaly) {
    break;
  }

  if (iteration < config.iterations && config.delayMs > 0) {
    await sleep(config.delayMs);
  }
}

console.error(`Anomalies: ${anomalyCount}`);
process.exitCode = anomalyCount > 0 ? 2 : 0;

async function execHttpRaw(args: {
  spriteName: string;
  apiKey: string;
  baseUrl: string;
  command: string;
}): Promise<RawExecResult> {
  const startedAtMs = Date.now();
  const url = new URL(`${args.baseUrl}/v1/sprites/${args.spriteName}/exec`);
  url.searchParams.append("cmd", "sh");
  url.searchParams.append("cmd", "-c");
  url.searchParams.append("cmd", args.command);
  url.searchParams.set("path", "sh");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Exec failed: ${response.status} ${await response.text()}`);
  }

  return readExecHttpResponse(response, startedAtMs);
}

async function readExecHttpResponse(
  response: Response,
  startedAtMs: number,
): Promise<RawExecResult> {
  const state: ExecHttpParseState = {
    stdout: "",
    stderr: "",
    exitCode: -1,
    stdoutDecoder: new TextDecoder(),
    stderrDecoder: new TextDecoder(),
  };

  if (!response.body) {
    return {
      stdout: "",
      stderr: "",
      exitCode: -1,
      durationMs: Date.now() - startedAtMs,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
      chunkCount: 0,
      rawTailHex: "",
      chunks: [],
    };
  }

  const reader = response.body.getReader();
  const buffers: Uint8Array[] = [];
  const chunks: ChunkSummary[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) { break; }

    buffers.push(value);
    totalBytes += value.byteLength;
    chunks.push(summarizeChunk(chunks.length + 1, value));
    parseExecHttpFrame(state, value);
  }

  state.stdout += state.stdoutDecoder.decode();
  state.stderr += state.stderrDecoder.decode();

  return {
    stdout: state.stdout.trimEnd(),
    stderr: state.stderr.trimEnd(),
    exitCode: state.exitCode,
    durationMs: Date.now() - startedAtMs,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
    chunkCount: chunks.length,
    rawTailHex: toHex(concatBytes(buffers).subarray(Math.max(0, totalBytes - RAW_TAIL_BYTES))),
    chunks,
  };
}

function parseExecHttpFrame(state: ExecHttpParseState, frame: Uint8Array): void {
  if (state.exitCode !== -1 || frame.length === 0) {
    return;
  }

  const streamId = frame[0];
  const payloadWithMaybeExit = frame.subarray(1);

  if (streamId === 0x03) {
    state.exitCode = payloadWithMaybeExit[0] ?? 0;
    return;
  }

  if (streamId === 0x01) {
    state.stdout += state.stdoutDecoder.decode(payloadWithMaybeExit, { stream: true });
  } else if (streamId === 0x02) {
    state.stderr += state.stderrDecoder.decode(payloadWithMaybeExit, { stream: true });
  }
}

function summarizeChunk(index: number, chunk: Uint8Array): ChunkSummary {
  return {
    index,
    byteLength: chunk.byteLength,
    firstByteHex: chunk[0] === undefined ? null : toHexByte(chunk[0]),
    firstByteKind: getStreamKind(chunk[0]),
    tailExitCandidate: getTailExitCandidate(chunk),
    preview: decodePreview(chunk),
    hex: toHex(chunk),
  };
}

function getTailExitCandidate(chunk: Uint8Array): number | null {
  if (chunk.byteLength < 2) {
    return null;
  }
  const marker = chunk[chunk.byteLength - 2];
  const exitCode = chunk[chunk.byteLength - 1];
  return marker === 0x03 && exitCode !== undefined ? exitCode : null;
}

function getStreamKind(value: number | undefined): string {
  switch (value) {
    case 0x01:
      return "stdout";
    case 0x02:
      return "stderr";
    case 0x03:
      return "exit";
    case undefined:
      return "empty";
    default:
      return "unknown";
  }
}

function classifyAnomaly(result: RawExecResult): string | null {
  if (result.exitCode === -1) {
    return "missing_exit_marker";
  }
  if (result.exitCode !== 0 && result.stdout.includes("codex is current:")) {
    return "current_stdout_nonzero_exit";
  }
  if (result.exitCode !== 0 && result.stdout.includes("codex is ready:")) {
    return "ready_stdout_nonzero_exit";
  }
  return null;
}

function getCodexStartupScript(codexMinVersion: string | undefined): string {
  const [check] = getOpenAICodexStartupToolchainChecks({
    logger: createNoopLogger(),
    codexMinVersion,
  });
  if (!check || typeof check.contract.script !== "string") {
    throw new Error("Codex startup check did not expose a script contract");
  }
  return check.contract.script;
}

function createNoopLogger(): Logger {
  return {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    scope() {
      return this;
    },
  };
}

function parseCli(args: string[]): CliConfig {
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const spriteName = args.find((arg) => !arg.startsWith("--"));
  if (!spriteName) {
    printUsage();
    process.exit(1);
  }

  return {
    spriteName,
    iterations: readNumberOption(args, "--iterations", DEFAULT_ITERATIONS),
    delayMs: readNumberOption(args, "--delay-ms", DEFAULT_DELAY_MS),
    minVersion: readStringOption(args, "--min-version"),
    continueOnAnomaly: args.includes("--continue-on-anomaly"),
    verboseChunks: args.includes("--verbose-chunks"),
    traceBashExit: args.includes("--trace-bash-exit"),
    xtrace: args.includes("--xtrace"),
    loginShell: args.includes("--login-shell"),
  };
}

function readStringOption(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readNumberOption(args: string[], name: string, defaultValue: number): number {
  const value = readStringOption(args, name);
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function printUsage(): void {
  console.error(
    "Usage: pnpm test:live:codex-toolchain-http <sprite-name> [--iterations=50] [--delay-ms=0] [--continue-on-anomaly] [--verbose-chunks] [--trace-bash-exit] [--xtrace] [--login-shell]",
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function truncateOutput(value: string): string {
  return value.length > MAX_OUTPUT_PREVIEW_LENGTH
    ? `${value.slice(0, MAX_OUTPUT_PREVIEW_LENGTH)}...`
    : value;
}

function decodePreview(value: Uint8Array): string {
  return truncateOutput(new TextDecoder().decode(value)
    .replaceAll("\u0001", "\\x01")
    .replaceAll("\u0002", "\\x02")
    .replaceAll("\u0003", "\\x03"));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function toHex(value: Uint8Array): string {
  return Array.from(value)
    .map(toHexByte)
    .join(" ");
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
