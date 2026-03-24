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

type UserRepoAccessError = {
  code: GitHubAppErrorCode;
  status: 422;
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
      code: "REPO_ACCESS_REVOKED";
      status: 403;
      message: string;
      justRevoked: boolean;
    };

export type SessionRepoAccessResult = Result<RepoAccessValue, SessionRepoAccessError>;

async function getAccessibleRepo(params: {
  env: Env;
  userId: string;
  repoId: number;
  githubAccessToken: string;
  installationId?: number;
}): Promise<UserRepoAccessResult> {
  const github = new GitHubAppService(params.env, logger);

  let installationId = params.installationId;
  if (!installationId) {
    const installationResult = await github.findInstallationForRepoId(
      params.repoId,
      params.githubAccessToken,
    );
    if (!installationResult.ok) {
      return failure({
        code: installationResult.error.code,
        status: 422,
        message: installationResult.error.message,
      });
    }
    installationId = installationResult.value.id;
  }

  const repositoryResult = await github.getUserAccessibleInstallationRepoById(
    params.userId,
    params.githubAccessToken,
    installationId,
    params.repoId,
  );
  if (!repositoryResult.ok) {
    return failure({
      code: repositoryResult.error.code,
      status: 422,
      message: repositoryResult.error.message,
    });
  }

  return success({
    userId: params.userId,
    repoId: repositoryResult.value.id,
    installationId,
    repoFullName: repositoryResult.value.fullName,
  });
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
  return getAccessibleRepo(params);
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

  if (session.revokedAt) {
    return failure({
      code: "REPO_ACCESS_REVOKED",
      status: 403,
      message: "Repository access for this session has been revoked.",
      justRevoked: false,
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

  const repoAccessResult = await getAccessibleRepo({
    env,
    userId,
    repoId: session.repoId,
    githubAccessToken,
    installationId: session.installationId ?? undefined,
  });

  if (!repoAccessResult.ok) {
    if (repoAccessResult.error.code === "REPO_NOT_ACCESSIBLE") {
      await sessionsRepository.markRevoked(sessionId, "REPO_ACCESS_REVOKED");
      return failure({
        code: "REPO_ACCESS_REVOKED",
        status: 403,
        message: "Repository access for this session has been revoked.",
        justRevoked: true,
      });
    }

    throw new Error(
      `Unexpected session repo access failure: ${repoAccessResult.error.code}`,
    );
  }

  if (session.installationId !== repoAccessResult.value.installationId) {
    logger.warn(`Session id ${sessionId} has a different installation id than the repo access result. Updating session record. ${session.installationId} -> ${repoAccessResult.value.installationId}`)
    await sessionsRepository.updateInstallationId(
      sessionId,
      repoAccessResult.value.installationId,
    );
  }

  return success(repoAccessResult.value);
}
