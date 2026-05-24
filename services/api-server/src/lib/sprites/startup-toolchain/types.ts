import type {
  DomainError,
  Logger,
  ProviderId,
  Result,
} from "@repo/shared";
import type { Env } from "@/types";
import type { WorkersSpriteClient } from "@/lib/sprites";
import type {
  StartupToolchainProviderCheckpoint,
} from "@/types/startup-toolchain";

export const STARTUP_TOOLCHAIN_DOMAIN = "startup_toolchain";

export interface ProviderStartupToolchainContract {
  provider: ProviderId;
  checks: Array<{
    id: string;
    minimumVersion?: string;
    repairScript?: string;
    verifierVersion: string;
  }>;
}

export type ProviderStartupToolchainError = DomainError<
  typeof STARTUP_TOOLCHAIN_DOMAIN,
  "CHECK_FAILED",
  {
    provider: ProviderId;
    checkId: string;
    requiredVersion?: string;
    installedVersion?: string | null;
    binaryPath?: string | null;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    cause?: string;
  }
>;

export interface ProviderStartupToolchainInput {
  sprite: WorkersSpriteClient;
  contractHash: string;
}

export interface ProviderStartupToolchain {
  getContract(): ProviderStartupToolchainContract;
  ensureReady(
    _input: ProviderStartupToolchainInput,
  ): Promise<Result<StartupToolchainProviderCheckpoint, ProviderStartupToolchainError>>;
}

export interface ProviderStartupToolchainDeps {
  env: Env;
  logger: Logger;
}
