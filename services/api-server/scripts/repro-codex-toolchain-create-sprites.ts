/**
 * Creates fresh Sprites, runs the Codex startup-toolchain command, and deletes
 * each Sprite after the iteration. Defaults to the old login-shell wrapper to
 * probe the SHLVL/logout failure mode.
 *
 * Usage:
 *   cd services/api-server
 *   pnpm test:live:codex-toolchain-create --iterations=5
 *
 * Env:
 *   SPRITES_API_KEY required
 *   SPRITES_API_URL optional, defaults to https://api.sprites.dev
 *   WORKER_URL optional, defaults to https://api.cloudecode.dev
 *   CODEX_MIN_VERSION optional, defaults through the provider check contract
 */
import dotenv from "dotenv";
import type { Logger } from "@repo/shared";
import { WorkersSpriteClient } from "../src/shared/integrations/sprites/WorkersSpriteClient";
import { buildBootstrapNetworkPolicy } from "../src/shared/integrations/sprites/network-policy";
import { SpritesCoordinator } from "../src/shared/integrations/sprites/sprites";
import { getOpenAICodexStartupToolchainChecks } from "../src/shared/integrations/sprites/startup-toolchain/providers/openai-codex";

const DEFAULT_ITERATIONS = 5;
const DEFAULT_DELAY_MS = 0;
const DEFAULT_WORKER_URL = "https://api.cloudecode.dev";
const MAX_OUTPUT_PREVIEW_LENGTH = 2000;

type ShellMode = "login" | "non-login";

type CliConfig = {
  iterations: number;
  delayMs: number;
  shellMode: ShellMode;
  minVersion?: string;
  namePrefix: string;
};

type IterationSummary = {
  type: "iteration";
  iteration: number;
  spriteName: string;
  shellMode: ShellMode;
  deleted: boolean;
  anomaly: string | null;
  createDurationMs: number;
  policyDurationMs: number | null;
  parentProbeDurationMs: number | null;
  startupDurationMs: number | null;
  deleteDurationMs: number | null;
  parentShlvl: string | null;
  childShlvl: string | null;
  childTerm: string | null;
  startupExitCode: number | null;
  startupStdout: string | null;
  startupStderr: string | null;
  error: string | null;
};

type ExecWithDuration = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

dotenv.config({
  path: [".env.local", "../../scripts/.env", "../../.env"],
  quiet: true,
});

const config = parseCli(process.argv.slice(2));
const SPRITES_API_KEY = process.env.SPRITES_API_KEY;
const SPRITES_API_URL = process.env.SPRITES_API_URL ?? "https://api.sprites.dev";
const WORKER_URL = process.env.WORKER_URL ?? DEFAULT_WORKER_URL;

if (!SPRITES_API_KEY) {
  console.error("Missing SPRITES_API_KEY env var");
  process.exit(1);
}

const coordinator = new SpritesCoordinator({ apiKey: SPRITES_API_KEY });
const baseStartupScript = getCodexStartupScript(config.minVersion ?? process.env.CODEX_MIN_VERSION);
const startupScript = [
  'echo "__probe_child_SHLVL=$SHLVL"',
  'echo "__probe_child_TERM=${TERM-unset}"',
  baseStartupScript,
].join("\n");
const shellFlag = config.shellMode === "login" ? "-lc" : "-c";
const startupCommand = `bash ${shellFlag} ${shellQuote(startupScript)}`;
const parentProbeCommand = 'printf "__probe_parent_SHLVL=%s\\n" "${SHLVL-unset}"; env | grep "^SHLVL=" || true';

console.error(`API: ${SPRITES_API_URL}`);
console.error(`Iterations: ${config.iterations}`);
console.error(`DelayMs: ${config.delayMs}`);
console.error(`ShellMode: ${config.shellMode}`);
console.error(`NamePrefix: ${config.namePrefix}`);
console.error(`WorkerURL: ${WORKER_URL}`);
console.error(`Command: ${startupCommand.slice(0, 120)}...`);

let anomalyCount = 0;
for (let iteration = 1; iteration <= config.iterations; iteration += 1) {
  const summary = await runIteration(iteration);
  if (summary.anomaly) {
    anomalyCount += 1;
  }
  console.log(JSON.stringify(summary));

  if (iteration < config.iterations && config.delayMs > 0) {
    await sleep(config.delayMs);
  }
}

console.error(`Anomalies: ${anomalyCount}`);
process.exitCode = anomalyCount > 0 ? 2 : 0;

async function runIteration(iteration: number): Promise<IterationSummary> {
  const spriteName = `${config.namePrefix}-${Date.now()}-${iteration}`;
  const startedAtMs = Date.now();
  let createDurationMs = 0;
  let policyDurationMs: number | null = null;
  let parentProbeResult: ExecWithDuration | null = null;
  let startupResult: ExecWithDuration | null = null;
  let deleteDurationMs: number | null;
  let deleted = false;
  let error: string | null = null;

  try {
    await coordinator.createSprite({ name: spriteName });
    createDurationMs = Date.now() - startedAtMs;
    const sprite = new WorkersSpriteClient(spriteName, SPRITES_API_KEY!, SPRITES_API_URL);

    const policyStartedAtMs = Date.now();
    const workerHostname = new URL(WORKER_URL).hostname;
    await sprite.setNetworkPolicy(buildBootstrapNetworkPolicy({ workerHostname }));
    policyDurationMs = Date.now() - policyStartedAtMs;

    parentProbeResult = await execWithDuration(sprite, parentProbeCommand);
    startupResult = await execWithDuration(sprite, startupCommand);
  } catch (caught) {
    error = getErrorMessage(caught);
  } finally {
    const deleteStartedAtMs = Date.now();
    try {
      await coordinator.deleteSprite(spriteName);
      deleted = true;
    } catch (caught) {
      error = error
        ? `${error}; delete failed: ${getErrorMessage(caught)}`
        : `delete failed: ${getErrorMessage(caught)}`;
    } finally {
      deleteDurationMs = Date.now() - deleteStartedAtMs;
    }
  }

  const parentShlvl = parentProbeResult
    ? readProbeValue(parentProbeResult.stdout, "__probe_parent_SHLVL=")
    : null;
  const childShlvl = startupResult
    ? readProbeValue(startupResult.stdout, "__probe_child_SHLVL=")
    : null;
  const childTerm = startupResult
    ? readProbeValue(startupResult.stdout, "__probe_child_TERM=")
    : null;
  const anomaly = startupResult ? classifyAnomaly(startupResult) : null;

  return {
    type: "iteration",
    iteration,
    spriteName,
    shellMode: config.shellMode,
    deleted,
    anomaly,
    createDurationMs,
    policyDurationMs,
    parentProbeDurationMs: parentProbeResult?.durationMs ?? null,
    startupDurationMs: startupResult?.durationMs ?? null,
    deleteDurationMs,
    parentShlvl,
    childShlvl,
    childTerm,
    startupExitCode: startupResult?.exitCode ?? null,
    startupStdout: startupResult ? truncateOutput(startupResult.stdout) : null,
    startupStderr: startupResult ? truncateOutput(startupResult.stderr) : null,
    error,
  };
}

async function execWithDuration(
  sprite: WorkersSpriteClient,
  command: string,
): Promise<ExecWithDuration> {
  const startedAtMs = Date.now();
  const result = await sprite.execHttp(command);
  return {
    ...result,
    durationMs: Date.now() - startedAtMs,
  };
}

function classifyAnomaly(result: ExecWithDuration): string | null {
  if (result.exitCode !== 0 && result.stdout.includes("codex is current:")) {
    return "current_stdout_nonzero_exit";
  }
  if (result.exitCode !== 0 && result.stdout.includes("codex is ready:")) {
    return "ready_stdout_nonzero_exit";
  }
  if (result.exitCode !== 0) {
    return "nonzero_exit";
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

  return {
    iterations: readNumberOption(args, "--iterations", DEFAULT_ITERATIONS),
    delayMs: readNumberOption(args, "--delay-ms", DEFAULT_DELAY_MS),
    shellMode: readShellMode(args),
    minVersion: readStringOption(args, "--min-version"),
    namePrefix: readStringOption(args, "--name-prefix") ?? "codex-toolchain-repro",
  };
}

function readShellMode(args: string[]): ShellMode {
  const value = readStringOption(args, "--shell") ?? "login";
  if (value === "login" || value === "non-login") {
    return value;
  }
  throw new Error(`Invalid --shell: ${value}`);
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
    "Usage: pnpm test:live:codex-toolchain-create [--iterations=5] [--delay-ms=0] [--shell=login|non-login] [--name-prefix=codex-toolchain-repro]",
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

function readProbeValue(stdout: string, prefix: string): string | null {
  const line = stdout.split("\n").find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length) : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
