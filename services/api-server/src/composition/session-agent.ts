import { getProviderAuthService } from "@/modules/ai-auth/services/provider-auth.service";
import { getProviderCredentialAdapter } from "@/modules/ai-auth/services/provider-credential-adapter.service";
import { UserSessionService } from "@/modules/auth/services/user-session.service";
import { GitHubAppService } from "@/modules/github/services/github-app.service";
import { createSessionSummaryWriter } from "@/modules/sessions/services/session-access.service";
import { assertSessionRepoAccess } from "@/modules/sessions/services/session-repo-access.service";
import { SessionAgentDO } from "@/modules/session-agent/session-agent.do";
import { configureSessionAgentRuntime } from "@/modules/session-agent/session-agent.runtime";
import { createLogger } from "@/shared/logging";

configureSessionAgentRuntime({
  createSessionSummaryRepository: createSessionSummaryWriter,
  createGitHubProvider: (env, logger) => new GitHubAppService(env, logger),
  assertSessionRepoAccess: (input) => {
    const github = new GitHubAppService(input.env, createLogger("session-agent-runtime.ts"));
    return assertSessionRepoAccess({
      ...input,
      providers: {
        github,
        userTokens: new UserSessionService({
          env: input.env,
          githubTokenRefreshProvider: github,
        }),
      },
    });
  },
  async getProviderConnectionStatus(provider, userId, env, logger) {
    return getProviderAuthService(provider, env, logger).getConnectionStatus(userId);
  },
  getProviderCredentialAdapter,
});

export { SessionAgentDO };
