import type { ProviderId } from "@repo/shared";
import { failure, success } from "@repo/shared";
import type { ExecResult } from "@/lib/sprites/types";
import type {
  ProviderStartupToolchainError,
} from "./types";
import { STARTUP_TOOLCHAIN_DOMAIN } from "./types";

const MAX_OUTPUT_LENGTH = 500;

export function startupToolchainError(
  provider: ProviderId,
  checkId: string,
  message: string,
  extra: Omit<
    ProviderStartupToolchainError,
    "domain" | "code" | "message" | "provider" | "checkId"
  > = {},
): ProviderStartupToolchainError {
  return {
    domain: STARTUP_TOOLCHAIN_DOMAIN,
    code: "CHECK_FAILED",
    message,
    provider,
    checkId,
    ...extra,
  };
}

export function truncateCommandOutput(value: string | undefined): string | undefined {
  if (!value) { return undefined; }
  return value.length > MAX_OUTPUT_LENGTH
    ? `${value.slice(0, MAX_OUTPUT_LENGTH)}...`
    : value;
}

export function execResultErrorFields(result: ExecResult): {
  stdout?: string;
  stderr?: string;
  exitCode: number;
} {
  return {
    stdout: truncateCommandOutput(result.stdout),
    stderr: truncateCommandOutput(result.stderr),
    exitCode: result.exitCode,
  };
}

export { failure, success };
