export type StartupToolchainCheckStatus = "ready";

export interface StartupToolchainCheckResult {
  id: string;
  status: StartupToolchainCheckStatus;
  requiredVersion?: string;
}

export interface StartupToolchainCheckpoint {
  contractHash: string;
  checkedAt: number;
  results: StartupToolchainCheckResult[];
}
