import type { ProviderId } from "@repo/shared";

export type StartupToolchainCheckStatus =
  | "already-current"
  | "updated"
  | "no-checks";

export interface StartupToolchainCheckResult {
  id: string;
  status: StartupToolchainCheckStatus;
  requiredVersion?: string;
  previousVersion?: string | null;
  version?: string | null;
  binaryPath?: string | null;
}

export interface StartupToolchainProviderCheckpoint {
  provider: ProviderId;
  contractHash: string;
  checkedAt: number;
  results: StartupToolchainCheckResult[];
}

export type StartupToolchainProviderCheckpoints = Partial<
  Record<ProviderId, StartupToolchainProviderCheckpoint>
>;

export interface StartupToolchainState {
  providers: StartupToolchainProviderCheckpoints;
}
