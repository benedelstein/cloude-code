import { UserSessionService } from "@/modules/auth/services/user-session.service";
import { GitHubAppService } from "@/modules/github/services/github-app.service";
import type { GitHubWebhookSessionProvider } from "@/modules/webhooks/providers/github-webhook.providers";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import {
  blockSessionsForDeletedInstallation,
  blockSessionsForRemovedRepos,
  blockSessionsForSuspendedInstallation,
  updatePullRequestFromWebhook,
} from "@/modules/sessions/services/session-access.service";
import { requestSessionAccessBlockedCleanup } from "@/modules/sessions/services/session-access-block.service";
import { createUserSessionsPublisher } from "@/modules/sessions/services/user-sessions-publisher.service";

export function createGitHubWebhookSessionProvider(
  env: Env,
): GitHubWebhookSessionProvider {
  const userSessionService = new UserSessionService({
    env,
    githubTokenRefreshProvider: new GitHubAppService(
      env,
      createLogger("github-webhook-session-provider.ts"),
    ),
  });
  const userSessionsPublisher = createUserSessionsPublisher(
    env,
    createLogger("github-webhook-user-sessions-publisher.ts"),
  );

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
    revokeUserSessionsByGithubId(githubId) {
      return userSessionService.revokeAllSessionsByGithubId(githubId);
    },
    async updatePullRequestFromWebhook(input) {
      const invalidations = await updatePullRequestFromWebhook({
        env,
        installationId: input.installationId,
        repoId: input.repoId,
        number: input.number,
        url: input.url,
        state: input.state,
      });
      // publish session update for each session referencing this pull request
      await Promise.allSettled(
        invalidations.map((row) =>
          userSessionsPublisher.invalidateSessionSummary({
            userId: row.userId,
            sessionId: row.id,
          }),
        ),
      );
    },
  };
}
