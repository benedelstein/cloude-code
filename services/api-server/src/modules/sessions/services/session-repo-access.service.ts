import type {
  GitHubAppErrorCode,
  GitHubAppResult,
  GitHubRepositoryData,
} from "@/shared/types/github";
import type {
  GitHubCredentialError,
  GitHubCredentialResult,
} from "@/shared/types/github-credential";
import { createLogger } from "@/shared/logging";
import type {
  RepoAccessValue,
  SessionRepoAccessError,
  SessionRepoAccessResult,
  UserRepoAccessError,
  UserRepoAccessResult,
} from "@/shared/types/repo-access";
import {
  blockSessionForAccessCheckDenied,
  clearSessionAccessBlockAndUpdateBinding,
  getSessionAccessRowForUser,
} from "./session-access.service";
import type { Env } from "@/shared/types";
import { failure, success, type SessionAccessBlockReason } from "@repo/shared";

const logger = createLogger("session-repo-access.ts");

export type {
  RepoAccessValue,
  SessionRepoAccessError,
  SessionRepoAccessResult,
  UserRepoAccessError,
  UserRepoAccessResult,
};

function gitHubCredentialToUserRepoAccessError(
  error: GitHubCredentialError,
): Extract<UserRepoAccessError, { code: "GITHUB_AUTH_REQUIRED" | "GITHUB_UNAVAILABLE" }> {
  switch (error.code) {
    case "GITHUB_AUTH_REQUIRED":
      return {
        code: error.code,
        status: error.status,
        message: error.message,
      };
    case "GITHUB_UNAVAILABLE":
      return {
        code: error.code,
        status: error.status,
        message: error.message,
      };
  }
}

function gitHubCredentialToSessionRepoAccessError(
  error: GitHubCredentialError,
): Extract<SessionRepoAccessError, { code: "GITHUB_AUTH_REQUIRED" | "GITHUB_UNAVAILABLE" }> {
  switch (error.code) {
    case "GITHUB_AUTH_REQUIRED":
      return {
        code: error.code,
        status: error.status,
        message: error.message,
      };
    case "GITHUB_UNAVAILABLE":
      return {
        code: error.code,
        status: error.status,
        message: error.message,
      };
  }
}

export interface SessionRepoAccessGitHubProvider {
  getUserAccessibleInstallationRepoById(
    userId: string,
    accessToken: string,
    installationId: number,
    repoId: number,
  ): Promise<GitHubAppResult<GitHubRepositoryData>>;
  findInstallationForRepoId(
    userId: string,
    repoId: number,
    accessToken: string,
  ): Promise<GitHubAppResult<{ id: number }>>;
}

export interface SessionRepoAccessUserTokenProvider {
  getValidGitHubCredentialByUserId(userId: string): Promise<GitHubCredentialResult>;
  forceRefreshGitHubCredentialByUserId(userId: string): Promise<GitHubCredentialResult>;
  getValidGitHubAccessTokenByUserId(userId: string): Promise<string | null>;
  forceRefreshGitHubAccessTokenByUserId(userId: string): Promise<string | null>;
}

export interface SessionRepoAccessProviders {
  github: SessionRepoAccessGitHubProvider;
  userTokens: SessionRepoAccessUserTokenProvider;
}

function mapGitHubAppErrorToUserRepoAccessError(error: {
  code: GitHubAppErrorCode;
  message: string;
}): UserRepoAccessError {
  switch (error.code) {
    case "INSTALLATION_NOT_FOUND":
    case "REPO_NOT_ACCESSIBLE":
      return {
        code: error.code,
        status: 403,
        message: error.message,
      };
    case "INVALID_REPO":
      return {
        code: error.code,
        status: 400,
        message: error.message,
      };
    case "GITHUB_API_ERROR":
      return {
        code: error.code,
        status: 503,
        message: error.message,
      };
    case "GITHUB_AUTH_ERROR":
      return {
        code: error.code,
        status: 401,
        message: error.message,
      };
    default: {
      const exhaustiveCheck: never = error.code;
      throw new Error(`Unhandled GitHub app error code: ${String(exhaustiveCheck)}`);
    }
  }
}

function getBlockedSessionAccessMessage(
  reason: SessionAccessBlockReason | null,
): string {
  switch (reason) {
    case "REPO_REMOVED_FROM_INSTALLATION":
      return "The GitHub App installation no longer has access to this repository.";
    case "INSTALLATION_DELETED":
      return "The GitHub App installation for this repository has been deleted.";
    case "INSTALLATION_SUSPENDED":
      return "The GitHub App installation for this repository is suspended.";
    case "ACCESS_CHECK_DENIED":
    case null:
      return "Repository access for this session is blocked. Update the GitHub App installation or your GitHub access to continue.";
    default: {
      const exhaustiveCheck: never = reason;
      throw new Error(`Unhandled session access block reason: ${String(exhaustiveCheck)}`);
    }
  }
}

function blockedSessionAccessResult(
  justBlocked: boolean,
  reason: SessionAccessBlockReason | null,
): SessionRepoAccessResult {
  return failure({
    code: "REPO_ACCESS_BLOCKED",
    status: 403,
    message: getBlockedSessionAccessMessage(reason),
    justBlocked,
  });
}

async function getUserAccessibleRepoForInstallation(params: {
  github: SessionRepoAccessGitHubProvider;
  userId: string;
  repoId: number;
  githubAccessToken: string;
  installationId: number;
}): Promise<UserRepoAccessResult> {
  const repositoryResult = await params.github.getUserAccessibleInstallationRepoById(
    params.userId,
    params.githubAccessToken,
    params.installationId,
    params.repoId,
  );
  if (!repositoryResult.ok) {
    return failure(mapGitHubAppErrorToUserRepoAccessError(repositoryResult.error));
  }

  return success({
    userId: params.userId,
    repoId: repositoryResult.value.id,
    installationId: params.installationId,
    repoFullName: repositoryResult.value.fullName,
  });
}

async function resolveAccessibleRepoForRecovery(params: {
  github: SessionRepoAccessGitHubProvider;
  userId: string;
  repoId: number;
  githubAccessToken: string;
}): Promise<UserRepoAccessResult> {
  const installationResult = await params.github.findInstallationForRepoId(
    params.userId,
    params.repoId,
    params.githubAccessToken,
  );
  if (!installationResult.ok) {
    return failure(mapGitHubAppErrorToUserRepoAccessError(installationResult.error));
  }
  logger.info("Found installation for repo", {
    fields: {
      repoId: params.repoId,
      installationId: installationResult.value.id,
    },
  });

  return getUserAccessibleRepoForInstallation({
    github: params.github,
    userId: params.userId,
    repoId: params.repoId,
    githubAccessToken: params.githubAccessToken,
    installationId: installationResult.value.id,
  });
}

/**
 * Runs a repo access check once with the caller's current GitHub token and retries
 * exactly once with a freshly refreshed token if GitHub rejects the original token
 * as no longer valid.
 */
async function retryUserRepoAccessAfterTokenRefresh(params: {
  userTokens: SessionRepoAccessUserTokenProvider;
  userId: string;
  githubAccessToken: string;
  resolve: (githubAccessToken: string) => Promise<UserRepoAccessResult>;
}): Promise<UserRepoAccessResult> {
  const initialResult = await params.resolve(params.githubAccessToken);
  if (initialResult.ok || initialResult.error.code !== "GITHUB_AUTH_ERROR") {
    return initialResult;
  }

  const refreshedGitHubCredential = await params.userTokens.forceRefreshGitHubCredentialByUserId(
    params.userId,
  );
  if (!refreshedGitHubCredential.ok) {
    return failure(gitHubCredentialToUserRepoAccessError(refreshedGitHubCredential.error));
  }

  if (refreshedGitHubCredential.value.accessToken === params.githubAccessToken) {
    return initialResult;
  }

  logger.info("Retrying GitHub repo access check with refreshed user token.", {
    fields: { userId: params.userId },
  });

  return params.resolve(refreshedGitHubCredential.value.accessToken);
}

/**
 * Checks whether a user can access a repo before a session is created.
 * @param params.env - Worker environment.
 * @param params.userId - Authenticated user id.
 * @param params.repoId - Numeric GitHub repo id.
 * @param params.githubAccessToken - Current GitHub user access token.
 * @returns Repository access result with installation metadata on success.
 */
export async function assertUserRepoAccess(params: {
  env: Env;
  providers: SessionRepoAccessProviders;
  userId: string;
  repoId: number;
  githubAccessToken?: string;
}): Promise<UserRepoAccessResult> {
  let githubAccessToken = params.githubAccessToken;
  if (!githubAccessToken) {
    const credentialResult = await params.providers.userTokens.getValidGitHubCredentialByUserId(
      params.userId,
    );
    if (!credentialResult.ok) {
      return failure(gitHubCredentialToUserRepoAccessError(credentialResult.error));
    }
    githubAccessToken = credentialResult.value.accessToken;
  }

  return retryUserRepoAccessAfterTokenRefresh({
    userTokens: params.providers.userTokens,
    userId: params.userId,
    githubAccessToken,
    resolve: (githubAccessToken) =>
      resolveAccessibleRepoForRecovery({
        github: params.providers.github,
        userId: params.userId,
        repoId: params.repoId,
        githubAccessToken,
      }),
  });
}

/**
 * Checks whether a user has access to the repo backing an existing session.
 * @param params.env - Worker environment.
 * @param params.sessionId - Session id to validate.
 * @param params.userId - Authenticated user id.
 * @param params.githubAccessToken - Optional GitHub user access token if the caller already has one.
 * @returns Session repo access result.
 */
export async function assertSessionRepoAccess(params: {
  env: Env;
  providers: SessionRepoAccessProviders;
  sessionId: string;
  userId: string;
  githubAccessToken?: string;
}): Promise<SessionRepoAccessResult> {
  const { env, sessionId, userId } = params;
  const session = await getSessionAccessRowForUser({ env, sessionId, userId });

  if (!session) {
    return failure({
      code: "SESSION_NOT_FOUND",
      status: 404,
      message: "Session not found",
    });
  }

  let githubAccessToken = params.githubAccessToken;
  if (!githubAccessToken) {
    const credentialResult = await params.providers.userTokens.getValidGitHubCredentialByUserId(
      userId,
    );
    if (!credentialResult.ok) {
      logger.warn("GitHub authentication required to verify session access.", {
        fields: { userId, sessionId, code: credentialResult.error.code },
      });
      return failure(gitHubCredentialToSessionRepoAccessError(credentialResult.error));
    }
    githubAccessToken = credentialResult.value.accessToken;
  }

  if (!githubAccessToken) {
    logger.warn("GitHub authentication required to verify session access.", {
      fields: { userId, sessionId },
    });
    return failure({
      code: "GITHUB_AUTH_REQUIRED",
      status: 401,
      message: "GitHub authentication required to verify session access.",
    });
  }

  const shouldUseRecoveryPath =
    session.accessBlockedAt !== null || session.installationId === null;

  // TODO: Fall back from a stale non-null installation binding if webhook invalidation is missed.
  const repoAccessResult = await retryUserRepoAccessAfterTokenRefresh({
    userTokens: params.providers.userTokens,
    userId,
    githubAccessToken,
    resolve: (nextGitHubAccessToken) =>
      shouldUseRecoveryPath
        ? resolveAccessibleRepoForRecovery({
            github: params.providers.github,
            userId,
            repoId: session.repoId,
            githubAccessToken: nextGitHubAccessToken,
          })
        : getUserAccessibleRepoForInstallation({
            github: params.providers.github,
            userId,
            repoId: session.repoId,
            githubAccessToken: nextGitHubAccessToken,
            installationId: session.installationId as number,
          }),
  });

  if (!repoAccessResult.ok) {
    switch (repoAccessResult.error.code) {
      case "REPO_NOT_ACCESSIBLE":
        await blockSessionForAccessCheckDenied({
          env,
          sessionId,
          clearInstallationId: false,
          preserveExistingBlockReason:
            shouldUseRecoveryPath && session.accessBlockReason !== null,
        });
        return blockedSessionAccessResult(
          !shouldUseRecoveryPath,
          session.accessBlockReason,
        );
      case "INSTALLATION_NOT_FOUND":
        await blockSessionForAccessCheckDenied({
          env,
          sessionId,
          clearInstallationId: true,
          preserveExistingBlockReason:
            shouldUseRecoveryPath && session.accessBlockReason !== null,
        });
        return blockedSessionAccessResult(
          !shouldUseRecoveryPath,
          session.accessBlockReason,
        );
      case "GITHUB_API_ERROR":
      case "GITHUB_UNAVAILABLE":
        logger.warn("GitHub session repo access check failed without an authoritative block result.", {
          fields: {
            userId,
            sessionId,
            repoId: session.repoId,
            installationId: session.installationId,
            code: repoAccessResult.error.code,
            recoveryPath: shouldUseRecoveryPath,
          },
        });
        return failure({
          code: repoAccessResult.error.code === "GITHUB_UNAVAILABLE"
            ? "GITHUB_UNAVAILABLE"
            : repoAccessResult.error.code,
          status: 503,
          message: "GitHub repository access could not be verified right now. Please retry.",
        });
      case "GITHUB_AUTH_ERROR":
      case "GITHUB_AUTH_REQUIRED":
        logger.warn("GitHub user authentication expired during session repo access check.", {
          fields: {
            userId,
            sessionId,
            repoId: session.repoId,
            installationId: session.installationId,
            recoveryPath: shouldUseRecoveryPath,
          },
        });
        return failure({
          code: "GITHUB_AUTH_REQUIRED",
          status: 401,
          message: "Reconnect GitHub to continue.",
        });
      case "INVALID_REPO":
        return failure({
          code: "INVALID_REPO",
          status: 400,
          message: "Invalid repository.",
        });
    }
  }

  if (
    session.installationId !== repoAccessResult.value.installationId ||
    session.repoFullName !== repoAccessResult.value.repoFullName ||
    session.accessBlockedAt !== null ||
    session.accessBlockReason !== null
  ) {
    await clearSessionAccessBlockAndUpdateBinding({
      env,
      sessionId,
      installationId: repoAccessResult.value.installationId,
      repoFullName: repoAccessResult.value.repoFullName,
    });
  }

  return success(repoAccessResult.value);
}
