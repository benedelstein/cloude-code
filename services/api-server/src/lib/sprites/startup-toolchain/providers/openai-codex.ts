import { MIN_CODEX_CLI_VERSION } from "@repo/shared";
import type { Logger } from "@repo/shared";
import type { WorkersSpriteClient } from "@/lib/sprites";
import type { ExecResult } from "@/lib/sprites/types";
import type {
  ProviderStartupToolchain,
  ProviderStartupToolchainContract,
  ProviderStartupToolchainError,
  ProviderStartupToolchainInput,
} from "../types";
import {
  execResultErrorFields,
  failure,
  startupToolchainError,
  success,
  truncateCommandOutput,
} from "../common";
import { isVersionAtLeast, parseSemanticVersion } from "../version";

const CODEX_CHECK_ID = "openai-codex.cli";
const CODEX_INSTALL_SCRIPT_URL = "https://chatgpt.com/codex/install.sh";
const CODEX_REPAIR_SCRIPT = `curl -fsSL ${CODEX_INSTALL_SCRIPT_URL} | sh`;
const CODEX_PATH_PREFIX = "$HOME/.local/bin:$HOME/bin:/usr/local/bin";
const CODEX_VERIFIER_VERSION = "1";

const CODEX_CONTRACT: ProviderStartupToolchainContract = {
  provider: "openai-codex",
  checks: [{
    id: CODEX_CHECK_ID,
    minimumVersion: MIN_CODEX_CLI_VERSION,
    repairScript: CODEX_REPAIR_SCRIPT,
    verifierVersion: CODEX_VERIFIER_VERSION,
  }],
};

interface CodexCliState {
  binaryPath: string | null;
  version: string | null;
  result: ExecResult;
}

function withCodexPath(command: string): string {
  return `export PATH="${CODEX_PATH_PREFIX}:$PATH"; ${command}`;
}

function parseCodexVersion(output: string): string | null {
  const version = parseSemanticVersion(output);
  return version ? `${version.major}.${version.minor}.${version.patch}` : null;
}

async function inspectCodexCli(sprite: WorkersSpriteClient): Promise<CodexCliState> {
  const result = await sprite.execHttp(withCodexPath(
    "binary=$(command -v codex 2>/dev/null || true); "
      + "if [ -z \"$binary\" ]; then exit 127; fi; "
      + "version=$(codex --version 2>&1); "
      + "status=$?; "
      + "printf 'path=%s\\nversion=%s\\n' \"$binary\" \"$version\"; "
      + "exit $status",
  ));
  const binaryPath = result.stdout.match(/^path=(.+)$/m)?.[1] ?? null;
  const versionOutput = result.stdout.match(/^version=(.+)$/m)?.[1] ?? "";
  return {
    binaryPath,
    version: parseCodexVersion(versionOutput),
    result,
  };
}

function failedInspection(
  state: CodexCliState,
): boolean {
  return state.result.exitCode !== 0 || !state.binaryPath || !state.version;
}

export class OpenAICodexStartupToolchain implements ProviderStartupToolchain {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.scope("openai-codex-startup-toolchain");
  }

  getContract(): ProviderStartupToolchainContract {
    return CODEX_CONTRACT;
  }

  async ensureReady(
    input: ProviderStartupToolchainInput,
  ) {
    const before = await inspectCodexCli(input.sprite);
    if (
      !failedInspection(before)
      && before.version
      && isVersionAtLeast(before.version, MIN_CODEX_CLI_VERSION)
    ) {
      this.logger.info("Startup toolchain check already current", {
        fields: {
          provider: "openai-codex",
          checkId: CODEX_CHECK_ID,
          requiredVersion: MIN_CODEX_CLI_VERSION,
          installedVersion: before.version,
          binaryPath: before.binaryPath,
          status: "already-current",
        },
      });
      return success({
        provider: "openai-codex" as const,
        contractHash: input.contractHash,
        checkedAt: Date.now(),
        results: [{
          id: CODEX_CHECK_ID,
          status: "already-current" as const,
          requiredVersion: MIN_CODEX_CLI_VERSION,
          previousVersion: before.version,
          version: before.version,
          binaryPath: before.binaryPath,
        }],
      });
    }

    const repairResult = await input.sprite.execHttp(withCodexPath(CODEX_REPAIR_SCRIPT));
    if (repairResult.exitCode !== 0) {
      return failure(this.repairError(
        "Codex CLI repair script failed.",
        before,
        repairResult,
      ));
    }

    const after = await inspectCodexCli(input.sprite);
    if (
      failedInspection(after)
      || !after.version
      || !isVersionAtLeast(after.version, MIN_CODEX_CLI_VERSION)
    ) {
      return failure(this.repairError(
        "Codex CLI did not satisfy the required version after repair.",
        after,
        after.result,
        before.version,
      ));
    }

    this.logger.info("Startup toolchain check updated CLI", {
      fields: {
        provider: "openai-codex",
        checkId: CODEX_CHECK_ID,
        requiredVersion: MIN_CODEX_CLI_VERSION,
        previousVersion: before.version,
        installedVersion: after.version,
        binaryPath: after.binaryPath,
        status: "updated",
      },
    });

    return success({
      provider: "openai-codex" as const,
      contractHash: input.contractHash,
      checkedAt: Date.now(),
      results: [{
        id: CODEX_CHECK_ID,
        status: "updated" as const,
        requiredVersion: MIN_CODEX_CLI_VERSION,
        previousVersion: before.version,
        version: after.version,
        binaryPath: after.binaryPath,
      }],
    });
  }

  private repairError(
    message: string,
    state: CodexCliState,
    result: ExecResult,
    previousVersion: string | null = state.version,
  ): ProviderStartupToolchainError {
    this.logger.warn("Startup toolchain check failed", {
      fields: {
        provider: "openai-codex",
        checkId: CODEX_CHECK_ID,
        requiredVersion: MIN_CODEX_CLI_VERSION,
        installedVersion: state.version,
        previousVersion,
        binaryPath: state.binaryPath,
        stdout: truncateCommandOutput(result.stdout) ?? null,
        stderr: truncateCommandOutput(result.stderr) ?? null,
        exitCode: result.exitCode,
      },
    });
    return startupToolchainError(
      "openai-codex",
      CODEX_CHECK_ID,
      message,
      {
        requiredVersion: MIN_CODEX_CLI_VERSION,
        installedVersion: state.version,
        binaryPath: state.binaryPath,
        ...execResultErrorFields(result),
      },
    );
  }
}

export const OPENAI_CODEX_INSTALL_SCRIPT_URL = CODEX_INSTALL_SCRIPT_URL;
export const OPENAI_CODEX_STARTUP_CHECK_ID = CODEX_CHECK_ID;
