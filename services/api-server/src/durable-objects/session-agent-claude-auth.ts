import type { ClaudeAuthState, Logger } from "@repo/shared";
import { WorkersSprite } from "@/lib/sprites";
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

export type EnsureClaudeCredentialsReadyForSendResult =
  | {
      ok: true;
      claudeAuthRequired: null;
      nextFingerprint: string;
      credentialsChanged: boolean;
    }
  | {
      ok: false;
      claudeAuthRequired: ClaudeAuthState | null;
      errorCode: string;
      errorMessage: string;
    };

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
    return {
      ok: false,
      claudeAuthRequired: null,
      errorCode: "CLAUDE_CREDENTIALS_SYNC_FAILED",
      errorMessage: "Session sprite is unavailable.",
    };
  }

  try {
    const credentials = await getClaudeCredentialsSnapshot({
      env: params.env,
      logger: params.logger,
      userId: params.userId,
    });

    if (!credentials) {
      return {
        ok: false,
        claudeAuthRequired: "auth_required",
        errorCode: "CLAUDE_AUTH_REQUIRED",
        errorMessage: "Claude authentication required for this session.",
      };
    }

    if (credentials.fingerprint === params.lastFingerprint) {
      return {
        ok: true,
        claudeAuthRequired: null,
        nextFingerprint: credentials.fingerprint,
        credentialsChanged: false,
      };
    }

    const sprite = new WorkersSprite(
      params.spriteName,
      params.env.SPRITES_API_KEY,
      params.env.SPRITES_API_URL,
    );
    await sprite.writeFile(
      `${HOME_DIR}/.claude/.credentials.json`,
      credentials.credentialsJson,
      { mode: "0600" },
    );

    return {
      ok: true,
      claudeAuthRequired: null,
      nextFingerprint: credentials.fingerprint,
      credentialsChanged: true,
    };
  } catch (error) {
    if (error instanceof ClaudeOAuthError) {
      return {
        ok: false,
        claudeAuthRequired: getClaudeAuthRequiredFromClaudeError(error),
        errorCode: error.code,
        errorMessage: error.message,
      };
    }

    return {
      ok: false,
      claudeAuthRequired: null,
      errorCode: "CLAUDE_CREDENTIALS_SYNC_FAILED",
      errorMessage: "Failed to sync Claude credentials for this session.",
    };
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
