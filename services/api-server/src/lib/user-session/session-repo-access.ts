import {
  GitHubAppService,
  type GitHubAppErrorCode,
} from "@/lib/github";
import { createLogger } from "@/lib/logger";
import { SessionsRepository } from "@/repositories/sessions.repository";
import { UserSessionService } from "@/lib/user-session/user-session.service";
import type { Env } from "@/types";
import { failure, success, type Result } from "@repo/shared";

const logger = createLogger("session-repo-access.ts");

type RepoAccessValue = {
  userId: string;
  repoId: number;
  installationId: number;
  repoFullName: string;
};

type UserRepoAccessError =
  | {
      code: "INSTALLATION_NOT_FOUND";
      status: 403;
      message: string;
    }
  | {
      code: "REPO_NOT_ACCESSIBLE";
      status: 403;
      message: string;
    }
  | {
      code: "INVALID_REPO";
      status: 400;
      message: string;
    }
  | {
      code: "GITHUB_API_ERROR";
      status: 503;
      message: string;
    }
  | {
      code: "GITHUB_AUTH_ERROR";
      status: 401;
      message: string;
    };

export type UserRepoAccessResult = Result<RepoAccessValue, UserRepoAccessError>;

export type SessionRepoAccessError =
  | {
      code: "SESSION_NOT_FOUND";
      status: 404;
      message: string;
    }
  | {
      code: "GITHUB_AUTH_REQUIRED";
      status: 401;
      message: string;
    }
  | {
      code: "REPO_ACCESS_BLOCKED";
      status: 403;
      message: string;
      /** True if the access was blocked just now, false if it was already blocked */
      justBlocked: boolean;
    }
  | {
      code: "GITHUB_API_ERROR";
      status: 503;
      message: string;
    }
  | {
      code: "INVALID_REPO";
      status: 400;
      message: string;
    };

export type SessionRepoAccessResult = Result<RepoAccessValue, SessionRepoAccessError>;

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

function blockedSessionAccessResult(justBlocked: boolean): SessionRepoAccessResult {
  return failure({
    code: "REPO_ACCESS_BLOCKED",
    status: 403,
    message: "You do not have access to this repository.",
    justBlocked,
  });
}

async function getUserAccessibleRepoForInstallation(params: {
  env: Env;
  userId: string;
  repoId: number;
  githubAccessToken: string;
  installationId: number;
}): Promise<UserRepoAccessResult> {
  const github = new GitHubAppService(params.env, logger);

  const repositoryResult = await github.getUserAccessibleInstallationRepoById(
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
  env: Env;
  userId: string;
  repoId: number;
  githubAccessToken: string;
}): Promise<UserRepoAccessResult> {
  const github = new GitHubAppService(params.env, logger);
  const installationResult = await github.findInstallationForRepoId(
    params.repoId,
    params.githubAccessToken,
  );
  if (!installationResult.ok) {
    return failure(mapGitHubAppErrorToUserRepoAccessError(installationResult.error));
  }
  logger.info(`found installation for repo ${params.repoId} in ${installationResult.value.id}`);

  return getUserAccessibleRepoForInstallation({
    env: params.env,
    userId: params.userId,
    repoId: params.repoId,
    githubAccessToken: params.githubAccessToken,
    installationId: installationResult.value.id,
  });
}

async function retryUserRepoAccessAfterTokenRefresh(params: {
  env: Env;
  userId: string;
  githubAccessToken: string;
  resolve: (githubAccessToken: string) => Promise<UserRepoAccessResult>;
}): Promise<UserRepoAccessResult> {
  const initialResult = await params.resolve(params.githubAccessToken);
  if (initialResult.ok || initialResult.error.code !== "GITHUB_AUTH_ERROR") {
    return initialResult;
  }

  const userSessionService = new UserSessionService(params.env);
  const refreshedGitHubAccessToken = await userSessionService.forceRefreshGitHubAccessTokenByUserId(
    params.userId,
  );
  if (!refreshedGitHubAccessToken || refreshedGitHubAccessToken === params.githubAccessToken) {
    return initialResult;
  }

  logger.info("Retrying GitHub repo access check with refreshed user token.", {
    fields: { userId: params.userId },
  });

  return params.resolve(refreshedGitHubAccessToken);
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
  userId: string;
  repoId: number;
  githubAccessToken: string;
}): Promise<UserRepoAccessResult> {
  return retryUserRepoAccessAfterTokenRefresh({
    env: params.env,
    userId: params.userId,
    githubAccessToken: params.githubAccessToken,
    resolve: (githubAccessToken) =>
      resolveAccessibleRepoForRecovery({
        env: params.env,
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
  sessionId: string;
  userId: string;
  githubAccessToken?: string;
}): Promise<SessionRepoAccessResult> {
  const { env, sessionId, userId } = params;
  const sessionsRepository = new SessionsRepository(env.DB);
  const session = await sessionsRepository.getAccessRowForUser(sessionId, userId);

  if (!session) {
    return failure({
      code: "SESSION_NOT_FOUND",
      status: 404,
      message: "Session not found",
    });
  }

  let githubAccessToken = params.githubAccessToken;
  if (!githubAccessToken) {
    const userSessionService = new UserSessionService(env);
    githubAccessToken = await userSessionService.getValidGitHubAccessTokenByUserId(
      userId,
    ) ?? undefined;
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
    env,
    userId,
    githubAccessToken,
    resolve: (nextGitHubAccessToken) =>
      shouldUseRecoveryPath
        ? resolveAccessibleRepoForRecovery({
            env,
            userId,
            repoId: session.repoId,
            githubAccessToken: nextGitHubAccessToken,
          })
        : getUserAccessibleRepoForInstallation({
            env,
            userId,
            repoId: session.repoId,
            githubAccessToken: nextGitHubAccessToken,
            installationId: session.installationId as number,
          }),
  });

  if (!repoAccessResult.ok) {
    switch (repoAccessResult.error.code) {
      case "REPO_NOT_ACCESSIBLE":
        await sessionsRepository.blockSessionForAccessCheckDenied(sessionId, {
          clearInstallationId: false,
          preserveExistingBlockReason:
            shouldUseRecoveryPath && session.accessBlockReason !== null,
        });
        return blockedSessionAccessResult(!shouldUseRecoveryPath);
      case "INSTALLATION_NOT_FOUND":
        await sessionsRepository.blockSessionForAccessCheckDenied(sessionId, {
          clearInstallationId: true,
          preserveExistingBlockReason:
            shouldUseRecoveryPath && session.accessBlockReason !== null,
        });
        return blockedSessionAccessResult(!shouldUseRecoveryPath);
      case "GITHUB_API_ERROR":
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
          code: repoAccessResult.error.code,
          status: 503,
          message: "GitHub repository access could not be verified right now. Please retry.",
        });
      case "GITHUB_AUTH_ERROR":
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
          message: "GitHub authentication required to verify session access.",
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
    await sessionsRepository.clearAccessBlockAndUpdateBinding(sessionId, {
      installationId: repoAccessResult.value.installationId,
      repoFullName: repoAccessResult.value.repoFullName,
    });
  }

  return success(repoAccessResult.value);
}
