import {
  type DomainError,
  type ClaudeAuthState,
  type Logger,
  type Result,
  failure,
  success,
} from "@repo/shared";
import { WorkersSpriteClient } from "@/lib/sprites";
import {
  ClaudeOAuthError,
  ClaudeOAuthService,
  type ClaudeConnectionStatus,
  getClaudeCredentialFingerprint,
  stringifyClaudeCredentials,
} from "@/lib/claude-oauth-service";
import type { Env } from "@/types";

const HOME_DIR = "/home/sprite";

export type ClaudeCredentialsSnapshot = {
  credentialsJson: string;
  fingerprint: string;
};

export type ClaudeAuthRefreshResult = {
  claudeAuthRequired: ClaudeAuthState | null;
};

export type ClaudeCredentialsReadyValue = {
  claudeAuthRequired: null;
  nextFingerprint: string;
  credentialsChanged: boolean;
};

export type ClaudeCredentialsSyncError =
  | DomainError<
      "claude_credentials",
      "CLAUDE_CREDENTIALS_SYNC_FAILED",
      { claudeAuthRequired: null }
    >
  | DomainError<
      "claude_credentials",
      "CLAUDE_AUTH_REQUIRED" | "CLAUDE_REAUTH_REQUIRED",
      { claudeAuthRequired: ClaudeAuthState }
    >
  | DomainError<
      "claude_credentials",
      "CLAUDE_INVALID_STATE" | "CLAUDE_INVALID_CODE" | "CLAUDE_TOKEN_EXCHANGE_FAILED" | "CLAUDE_TOKEN_REFRESH_FAILED",
      { claudeAuthRequired: ClaudeAuthState | null }
    >;

export type EnsureClaudeCredentialsReadyForSendResult = Result<
  ClaudeCredentialsReadyValue,
  ClaudeCredentialsSyncError
>;

export function getClaudeAuthRequiredFromClaudeError(
  error: ClaudeOAuthError,
): ClaudeAuthState | null {
  switch (error.code) {
    case "CLAUDE_AUTH_REQUIRED":
      return "auth_required";
    case "CLAUDE_REAUTH_REQUIRED":
      return "reauth_required";
    default:
      return null;
  }
}

export async function refreshClaudeAuthRequired(params: {
  env: Env;
  logger: Logger;
  userId: string | null;
}): Promise<ClaudeAuthRefreshResult> {
  if (!params.userId) {
    return { claudeAuthRequired: "auth_required" };
  }

  const claudeOAuthService = new ClaudeOAuthService(params.env, params.logger);
  const status = await claudeOAuthService.getConnectionStatus(params.userId);

  return {
    claudeAuthRequired: getClaudeAuthRequiredFromConnectionStatus(status),
  };
}

export async function getClaudeCredentialsSnapshot(params: {
  env: Env;
  logger: Logger;
  userId: string | null;
}): Promise<ClaudeCredentialsSnapshot | null> {
  if (!params.userId) {
    return null;
  }

  const claudeOAuthService = new ClaudeOAuthService(params.env, params.logger);
  const credentials = await claudeOAuthService.getValidCredentials(params.userId);

  return {
    credentialsJson: stringifyClaudeCredentials(credentials),
    fingerprint: getClaudeCredentialFingerprint(credentials),
  };
}

export async function ensureClaudeCredentialsReadyForSend(params: {
  env: Env;
  logger: Logger;
  userId: string | null;
  spriteName: string | null;
  lastFingerprint: string | null;
}): Promise<EnsureClaudeCredentialsReadyForSendResult> {
  if (!params.spriteName) {
    return failure({
      domain: "claude_credentials",
      code: "CLAUDE_CREDENTIALS_SYNC_FAILED",
      message: "Session sprite is unavailable.",
      claudeAuthRequired: null,
    });
  }

  try {
    const credentials = await getClaudeCredentialsSnapshot({
      env: params.env,
      logger: params.logger,
      userId: params.userId,
    });

    if (!credentials) {
      return failure({
        domain: "claude_credentials",
        code: "CLAUDE_AUTH_REQUIRED",
        message: "Claude authentication required for this session.",
        claudeAuthRequired: "auth_required",
      });
    }

    if (credentials.fingerprint === params.lastFingerprint) {
      return success({
        claudeAuthRequired: null,
        nextFingerprint: credentials.fingerprint,
        credentialsChanged: false,
      });
    }

    const sprite = new WorkersSpriteClient(
      params.spriteName,
      params.env.SPRITES_API_KEY,
      params.env.SPRITES_API_URL,
    );
    await sprite.writeFile(
      `${HOME_DIR}/.claude/.credentials.json`,
      credentials.credentialsJson,
      { mode: "0600" },
    );

    return success({
      claudeAuthRequired: null,
      nextFingerprint: credentials.fingerprint,
      credentialsChanged: true,
    });
  } catch (error) {
    if (error instanceof ClaudeOAuthError) {
      switch (error.code) {
        case "CLAUDE_AUTH_REQUIRED":
        case "CLAUDE_REAUTH_REQUIRED":
          return failure({
            domain: "claude_credentials",
            code: error.code,
            message: error.message,
            claudeAuthRequired: error.code === "CLAUDE_AUTH_REQUIRED"
              ? "auth_required"
              : "reauth_required",
          });
        case "CLAUDE_INVALID_STATE":
        case "CLAUDE_INVALID_CODE":
        case "CLAUDE_TOKEN_EXCHANGE_FAILED":
        case "CLAUDE_TOKEN_REFRESH_FAILED":
          return failure({
            domain: "claude_credentials",
            code: error.code,
            message: error.message,
            claudeAuthRequired: getClaudeAuthRequiredFromClaudeError(error),
          });
      }
    }

    return failure({
      domain: "claude_credentials",
      code: "CLAUDE_CREDENTIALS_SYNC_FAILED",
      message: "Failed to sync Claude credentials for this session.",
      claudeAuthRequired: null,
    });
  }
}

function getClaudeAuthRequiredFromConnectionStatus(
  status: ClaudeConnectionStatus,
): ClaudeAuthState | null {
  if (status.connected) {
    return null;
  }

  return status.requiresReauth ? "reauth_required" : "auth_required";
}
