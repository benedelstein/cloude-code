import type { Logger, ProviderId, Result } from "@repo/shared";
import { failure, success } from "@repo/shared";
import type { WorkersSpriteClient } from "@/lib/sprites";
import { sha256 } from "@/lib/utils/crypto";
import type {
  StartupToolchainCheckpoint,
} from "@/types/startup-toolchain";
import { getCommonStartupToolchainChecks } from "./checks/common";
import { getClaudeStartupToolchainChecks } from "./providers/claude";
import { getOpenAICodexStartupToolchainChecks } from "./providers/openai-codex";
import type {
  StartupToolchainCheck,
  StartupToolchainDeps,
  StartupToolchainError,
} from "./types";

export * from "./types";
export * from "./version";
export {
  OPENAI_CODEX_INSTALL_SCRIPT_URL,
  OPENAI_CODEX_STARTUP_CHECK_ID,
} from "./providers/openai-codex";

export function getProviderStartupToolchainChecks(
  providerId: ProviderId,
  deps: StartupToolchainDeps,
): StartupToolchainCheck[] {
  switch (providerId) {
    case "claude-code":
      return getClaudeStartupToolchainChecks();
    case "openai-codex":
      return getOpenAICodexStartupToolchainChecks(deps.logger);
    default: {
      const exhaustiveCheck: never = providerId;
      throw new Error(`Unhandled provider: ${exhaustiveCheck}`);
    }
  }
}

export async function buildStartupToolchainContractHash(
  providerId: ProviderId,
  checks: StartupToolchainCheck[],
): Promise<string> {
  return sha256(JSON.stringify({
    providerId,
    checks: checks.map((check) => check.contract),
  }));
}

export async function ensureSpriteStartupToolchain(args: {
  providerId: ProviderId;
  sprite: WorkersSpriteClient;
  checkpoint: StartupToolchainCheckpoint | null;
  logger: Logger;
}): Promise<Result<StartupToolchainCheckpoint, StartupToolchainError>> {
  const checks = [
    ...getCommonStartupToolchainChecks(),
    ...getProviderStartupToolchainChecks(args.providerId, {
      logger: args.logger,
    }),
  ];
  const contractHash = await buildStartupToolchainContractHash(
    args.providerId,
    checks,
  );
  if (args.checkpoint?.contractHash === contractHash) {
    args.logger.debug("Startup toolchain checkpoint is current", {
      fields: { contractHash, provider: args.providerId },
    });
    return success(args.checkpoint);
  }

  const results = [];
  for (const check of checks) {
    const result = await check.ensureReady({ sprite: args.sprite });
    if (!result.ok) {
      return failure(result.error);
    }
    results.push(result.value);
  }

  args.logger.info("Startup toolchain checks completed", {
    fields: {
      provider: args.providerId,
      contractHash,
      checkCount: checks.length,
    },
  });

  return success({
    contractHash,
    checkedAt: Date.now(),
    results,
  });
}
