import type { Logger, ProviderId, Result } from "@repo/shared";
import { failure, success } from "@repo/shared";
import type { Env } from "@/types";
import type { WorkersSpriteClient } from "@/lib/sprites";
import { sha256 } from "@/lib/utils/crypto";
import type {
  StartupToolchainProviderCheckpoint,
} from "@/types/startup-toolchain";
import { ClaudeStartupToolchain } from "./providers/claude";
import { OpenAICodexStartupToolchain } from "./providers/openai-codex";
import type {
  ProviderStartupToolchain,
  ProviderStartupToolchainDeps,
  ProviderStartupToolchainError,
} from "./types";

export * from "./types";
export * from "./version";
export {
  OPENAI_CODEX_INSTALL_SCRIPT_URL,
  OPENAI_CODEX_STARTUP_CHECK_ID,
} from "./providers/openai-codex";

export function getProviderStartupToolchain(
  providerId: ProviderId,
  deps: ProviderStartupToolchainDeps,
): ProviderStartupToolchain {
  switch (providerId) {
    case "claude-code":
      return new ClaudeStartupToolchain();
    case "openai-codex":
      return new OpenAICodexStartupToolchain(deps.logger);
    default: {
      const exhaustiveCheck: never = providerId;
      throw new Error(`Unhandled provider: ${exhaustiveCheck}`);
    }
  }
}

export async function buildStartupToolchainContractHash(
  toolchain: ProviderStartupToolchain,
): Promise<string> {
  return sha256(JSON.stringify(toolchain.getContract()));
}

export async function ensureSpriteStartupToolchain(args: {
  providerId: ProviderId;
  sprite: WorkersSpriteClient;
  checkpoint: StartupToolchainProviderCheckpoint | null;
  env: Env;
  logger: Logger;
}): Promise<Result<StartupToolchainProviderCheckpoint, ProviderStartupToolchainError>> {
  const toolchain = getProviderStartupToolchain(args.providerId, {
    env: args.env,
    logger: args.logger,
  });
  const contractHash = await buildStartupToolchainContractHash(toolchain);
  if (args.checkpoint?.contractHash === contractHash) {
    args.logger.debug("Startup toolchain checkpoint is current", {
      fields: {
        provider: args.providerId,
        contractHash,
      },
    });
    return success(args.checkpoint);
  }

  const result = await toolchain.ensureReady({
    sprite: args.sprite,
    contractHash,
  });
  if (!result.ok) {
    return failure(result.error);
  }
  return success(result.value);
}
