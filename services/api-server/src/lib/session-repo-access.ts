import { GitHubAppError, GitHubAppService } from "@/lib/github";
import { createLogger } from "@/lib/logger";
import { SessionHistoryService } from "@/lib/session-history";
import { UserSessionService } from "@/lib/user-session/user-session.service";
import type { Env } from "@/types";
import { failure, success, type Result } from "@repo/shared";

const logger = createLogger("session-repo-access.ts");

export const REPO_ACCESS_REVOKED_CODE = "REPO_ACCESS_REVOKED" as const;

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
      code: typeof REPO_ACCESS_REVOKED_CODE;
      status: 403;
      message: string;
      justRevoked: boolean;
    };

export type SessionRepoAccessResult = Result<
  {
    sessionId: string;
    userId: string;
    repoId: number;
    installationId: number;
    repoFullName: string;
  },
  SessionRepoAccessError
>;

/**
 * Checks if a user has access to a coding session
 * @param params.env - The environment.
 * @param params.sessionId - The session id.
 * @param params.userId - The user id.
 * @param params.githubAccessToken - The user's GitHub access token.
 * @returns The session repo access result.
 */
export async function assertSessionRepoAccess(params: {
  env: Env;
  sessionId: string;
  userId: string;
  githubAccessToken?: string;
}): Promise<SessionRepoAccessResult> {
  const { env, sessionId, userId } = params;
  const sessionHistory = new SessionHistoryService(env.DB);
  const session = await sessionHistory.getAccessRowForUser(sessionId, userId);

  if (!session) {
    return failure({
      code: "SESSION_NOT_FOUND",
      status: 404,
      message: "Session not found",
    });
  }

  if (session.revokedAt) {
    return failure({
      code: REPO_ACCESS_REVOKED_CODE,
      status: 403,
      message: "Repository access for this session has been revoked.",
      justRevoked: false,
    });
  }

  let githubAccessToken = params.githubAccessToken;
  if (!githubAccessToken) {
    const userSessionService = new UserSessionService(env);
    githubAccessToken = await userSessionService.getValidGitHubAccessTokenByUserId(userId) ?? undefined;
  }

  if (!githubAccessToken) {
    logger.error("GitHub authentication required to verify session access.", { fields: { userId } });
    return failure({
      code: "GITHUB_AUTH_REQUIRED",
      status: 401,
      message: "GitHub authentication required to verify session access.",
    });
  }

  const github = new GitHubAppService(env, logger);
  let installationId = session.installationId;

  if (!installationId) {
    const installation = await github.findInstallationForRepoId(
      session.repoId,
      githubAccessToken,
    );
    installationId = installation.id;
    await sessionHistory.updateInstallationId(sessionId, installationId);
  }

  try {
    await github.getUserAccessibleInstallationRepoById(
      userId,
      githubAccessToken,
      installationId,
      session.repoId,
    );
  } catch (error) {
    // TODO: use result type
    if (error instanceof GitHubAppError && error.code === "REPO_NOT_ACCESSIBLE") {
      await sessionHistory.markRevoked(sessionId, REPO_ACCESS_REVOKED_CODE);
      return failure({
        code: REPO_ACCESS_REVOKED_CODE,
        status: 403,
        message: "Repository access for this session has been revoked.",
        justRevoked: true,
      });
    }
    throw error;
  }

  return success({
    sessionId,
    userId,
    repoId: session.repoId,
    installationId,
    repoFullName: session.repoFullName,
  });
}
