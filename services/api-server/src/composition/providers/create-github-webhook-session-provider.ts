import { UserSessionService } from "@/modules/auth/services/user-session.service";
import { GitHubAppService } from "@/modules/github/services/github-app.service";
import type { GitHubWebhookSessionProvider } from "@/modules/webhooks/providers/github-webhook.providers";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import {
  blockSessionsForDeletedInstallation,
  blockSessionsForRemovedRepos,
  blockSessionsForSuspendedInstallation,
  findSessionsByPullRequest,
} from "@/modules/sessions/services/session-access.service";
import { requestSessionAccessBlockedCleanup } from "@/modules/sessions/services/session-access-block.service";
import { getSessionAgentStub } from "@/modules/session-agent/services/session-agent-stub.service";

export function createGitHubWebhookSessionProvider(
  env: Env,
): GitHubWebhookSessionProvider {
  const logger = createLogger("github-webhook-session-provider.ts");
  const userSessionService = new UserSessionService({
    env,
    githubTokenRefreshProvider: new GitHubAppService(
      env,
      logger,
    ),
  });

  return {
    blockSessionsForDeletedInstallation(installationId) {
      return blockSessionsForDeletedInstallation(env, installationId);
    },
    blockSessionsForSuspendedInstallation(installationId) {
      return blockSessionsForSuspendedInstallation(env, installationId);
    },
    blockSessionsForRemovedRepos(input) {
      return blockSessionsForRemovedRepos({
        env,
        installationId: input.installationId,
        repoIds: input.repoIds,
      });
    },
    async requestAccessBlockedCleanup(sessionIds) {
      await Promise.allSettled(
        sessionIds.map((sessionId) =>
          requestSessionAccessBlockedCleanup(env, sessionId),
        ),
      );
    },
    revokeUserGitHubCredentialsByGithubId(githubId) {
      return userSessionService.revokeGitHubCredentialsByGithubId(githubId);
    },
    async updatePullRequestFromWebhook(input) {
      const sessions = await findSessionsByPullRequest({
        env,
        installationId: input.installationId,
        repoId: input.repoId,
        number: input.number,
      });

      const results = await Promise.allSettled(
        sessions.map(async (session) => {
          const sessionAgent = await getSessionAgentStub(env, session.id);
          const updateResult = await sessionAgent.updatePullRequest({
            state: input.state,
          });
          return { session, updateResult };
        }),
      );

      results.forEach((result, index) => {
        const session = sessions[index];
        if (!session) {
          return;
        }

        if (result.status === "rejected") {
          logger.error("Failed to update session pull request from webhook", {
            error: result.reason,
            fields: {
              sessionId: session.id,
              userId: session.userId,
              state: input.state,
            },
          });
          return;
        }

        if (!result.value.updateResult.ok) {
          logger.warn("Session pull request update from webhook was skipped", {
            fields: {
              sessionId: session.id,
              userId: session.userId,
              state: input.state,
              code: result.value.updateResult.error.code,
            },
          });
        }
      });
    },
  };
}
