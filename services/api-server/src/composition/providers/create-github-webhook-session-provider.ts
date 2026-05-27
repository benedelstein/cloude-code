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
    updatePullRequestFromWebhook(input) {
      return updatePullRequestFromWebhook({
        env,
        installationId: input.installationId,
        repoId: input.repoId,
        number: input.number,
        url: input.url,
        state: input.state,
      });
    },
  };
}
