export type StartupToolchainCheckStatus =
  | "already-current"
  | "updated";

export interface StartupToolchainCheckResult {
  id: string;
  status: StartupToolchainCheckStatus;
  requiredVersion?: string;
  previousVersion?: string | null;
  version?: string | null;
  binaryPath?: string | null;
}

export interface StartupToolchainCheckpoint {
  contractHash: string;
  checkedAt: number;
  results: StartupToolchainCheckResult[];
}
