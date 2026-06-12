import type { Repo } from "@repo/shared";
import { createClaudeAuthRoutes } from "@/modules/ai-auth/routes/claude.routes";
import { createModelsRoutes } from "@/modules/ai-auth/routes/models.routes";
import { createOpenAIAuthRoutes } from "@/modules/ai-auth/routes/openai.routes";
import { createAttachmentsRoutes } from "@/modules/attachments/routes/attachments.routes";
import { AttachmentService } from "@/modules/attachments/services/attachment.service";
import { createAuthRoutes } from "@/modules/auth/routes/auth.routes";
import { createIntegrationsRoutes } from "@/modules/integrations/routes/integrations.routes";
import { IntegrationSessionRequestService } from "@/modules/integrations/services/integration-session-request.service";
import type { IntegrationRepoCandidateProvider } from "@/modules/integrations/types/integrations.types";
import {
  authenticateBearerToken,
  createAuthMiddleware,
} from "@/modules/auth/middleware/auth.middleware";
import { UserSessionService } from "@/modules/auth/services/user-session.service";
import { GitHubAppService } from "@/modules/github/services/github-app.service";
import {
  createRepoScopedEnvironmentRoutes,
  createUserEnvironmentRoutes,
} from "@/modules/repo-environments/routes/repo-environments.routes";
import { RepoEnvironmentsService } from "@/modules/repo-environments/services/repo-environments.service";
import { ReposService } from "@/modules/github/services/repo-listing.service";
import { createReposRoutes } from "@/modules/repos/routes/repos.routes";
import { createAgentRoutes } from "@/modules/session-agent/routes/agent.routes";
import { createGitProxyRoutes } from "@/modules/session-agent/routes/git-proxy.routes";
import { createInternalRoutes } from "@/modules/session-agent/routes/internal.routes";
import { createSessionsRoutes } from "@/modules/sessions/routes/sessions.routes";
import { SessionsService } from "@/modules/sessions/services/sessions.service";
import { createVoiceRoutes } from "@/modules/voice/routes/voice.routes";
import { VoiceTranscriptionService } from "@/modules/voice/services/voice-transcription.service";
import { requestSessionAccessBlockedCleanup } from "@/modules/sessions/services/session-access-block.service";
import {
  assertSessionRepoAccess,
  assertUserRepoAccess,
} from "@/modules/sessions/services/session-repo-access.service";
import { isSessionOwnedByUser } from "@/modules/sessions/services/session-access.service";
import { requestSessionProviderConnectionRefresh } from "@/modules/sessions/services/session-provider-connection.service";
import { verifySessionWebSocketToken } from "@/modules/sessions/services/session-websocket-token.service";
import { verifyUserSessionsWebSocketToken } from "@/modules/sessions/services/user-sessions-websocket-token.service";
import { createWebhooksRoutes } from "@/modules/webhooks/routes/webhooks.routes";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import { createGithubWebhookService } from "./providers/create-github-webhook-handler";

function createGitHubAppService(env: Env, label: string): GitHubAppService {
  return new GitHubAppService(env, createLogger(label));
}

function createUserSessionService(env: Env): UserSessionService {
  return new UserSessionService({
    env,
    githubTokenRefreshProvider: createGitHubAppService(
      env,
      "user-session.service.ts",
    ),
  });
}

function createRepoAccessProviders(env: Env) {
  return {
    github: createGitHubAppService(env, "session-repo-access.ts"),
    userTokens: createUserSessionService(env),
  };
}

function createSessionsService(env: Env): SessionsService {
  return new SessionsService({
    env,
    attachmentProvider: new AttachmentService(env.DB),
    repoAccessProviders: createRepoAccessProviders(env),
    repoEnvironmentResolver: new RepoEnvironmentsService({
      env,
      accessProvider: {
        assertUserRepoAccess: (input) =>
          assertUserRepoAccess({
            ...input,
            providers: createRepoAccessProviders(input.env),
          }),
      },
    }),
    createPullRequestGitHubProvider: () =>
      createGitHubAppService(env, "sessions.service.ts"),
  });
}

function createIntegrationRepoCandidateProvider(env: Env): IntegrationRepoCandidateProvider {
  return {
    async listAccessibleRepos(params) {
      const reposService = new ReposService(env);
      const repos: Repo[] = [];
      let cursor: string | undefined;

      while (repos.length < params.limit) {
        const result = await reposService.listRepos({
          userId: params.userId,
          githubAccessToken: params.githubAccessToken,
          executionCtx: params.executionCtx,
          limit: Math.min(100, params.limit - repos.length),
          cursor,
        });
        if (!result.ok) {
          return result;
        }

        repos.push(...result.value.repos);
        if (!result.value.cursor) {
          break;
        }
        cursor = result.value.cursor;
      }

      return { ok: true, value: repos };
    },
    async getReadme(params) {
      const [owner, repoName] = params.repo.fullName.split("/");
      if (!owner || !repoName) {
        return null;
      }

      const github = createGitHubAppService(env, "integration-repo-router.ts");
      try {
        return await github.getRepositoryReadme({
          accessToken: params.githubAccessToken,
          owner,
          repo: repoName,
        });
      } catch {
        return null;
      }
    },
  };
}

const authMiddleware = createAuthMiddleware((env, token) =>
  authenticateBearerToken(env, token, (sessionEnv, sessionToken) =>
    createUserSessionService(sessionEnv).getAuthenticatedUserBySessionToken(
      sessionToken,
    )
  ),
);

export function buildAgentRoutes() {
  return createAgentRoutes({
    verifySessionWebSocketToken,
    assertSessionRepoAccess: (input) =>
      assertSessionRepoAccess({
        ...input,
        providers: createRepoAccessProviders(input.env),
      }),
    requestSessionAccessBlockedCleanup,
  });
}

export function buildAuthRoutes() {
  const authRoutes = createAuthRoutes({
    authMiddleware,
    createGitHubClient(env, logger) {
      const github = new GitHubAppService(env, logger);
      return {
        getAuthUrl: (state) => github.getAuthUrl(state),
        getInstallUrl: () => github.getInstallUrl(),
        exchangeOAuthCode: (code) => github.exchangeOAuthCode(code),
        hasInstallations: (accessToken) => github.hasInstallations(accessToken),
      };
    },
  });

  // provider auth routes are prefixed under /auth/ as well.
  authRoutes.route(
    "/",
    createOpenAIAuthRoutes({
      authMiddleware,
      requestSessionProviderConnectionRefresh,
    }),
  );

  authRoutes.route(
    "/",
    createClaudeAuthRoutes({
      authMiddleware,
      requestSessionProviderConnectionRefresh,
    }),
  );

  return authRoutes;
}

export function buildGitProxyRoutes() {
  return createGitProxyRoutes();
}

export function buildInternalRoutes() {
  return createInternalRoutes();
}

export function buildModelsRoutes() {
  return createModelsRoutes({ authMiddleware });
}

export function buildReposRoutes() {
  return createReposRoutes({
    authMiddleware,
    createReposService: (env) => new ReposService(env),
    getValidGitHubCredentialByUserId: (env, userId) =>
      createUserSessionService(env).getValidGitHubCredentialByUserId(userId),
  });
}

function createRepoEnvironmentsRouteDeps() {
  return {
    authMiddleware,
    createRepoEnvironmentsService: (env: Env) =>
      new RepoEnvironmentsService({
        env,
        accessProvider: {
          assertUserRepoAccess: (input) =>
            assertUserRepoAccess({
              ...input,
              providers: createRepoAccessProviders(input.env),
            }),
        },
      }),
  };
}

export function buildRepoScopedEnvironmentRoutes() {
  return createRepoScopedEnvironmentRoutes(createRepoEnvironmentsRouteDeps());
}

export function buildUserEnvironmentRoutes() {
  return createUserEnvironmentRoutes(createRepoEnvironmentsRouteDeps());
}

export function buildSessionsRoutes() {
  return createSessionsRoutes({
    authMiddleware,
    verifyUserSessionsWebSocketToken,
    createSessionsService,
  });
}

export function buildIntegrationsRoutes() {
  return createIntegrationsRoutes({
    authMiddleware,
    createIntegrationSessionRequestService: (env) =>
      new IntegrationSessionRequestService(env, {
        tokenProvider: createUserSessionService(env),
        repoCandidateProvider: createIntegrationRepoCandidateProvider(env),
        environmentProvider: {
          async getDefaultEnvironmentId(params) {
            const service = new RepoEnvironmentsService({
              env,
              accessProvider: {
                assertUserRepoAccess: (input) =>
                  assertUserRepoAccess({
                    ...input,
                    providers: createRepoAccessProviders(input.env),
                  }),
              },
            });
            const result = await service.list(params);
            return result.ok ? result.value.environments[0]?.id ?? null : null;
          },
        },
        sessionCreator: createSessionsService(env),
      }),
  });
}

export function buildVoiceRoutes() {
  return createVoiceRoutes({
    authMiddleware,
    createVoiceTranscriptionService: (env) => new VoiceTranscriptionService(env),
  });
}

export function buildAttachmentsRoutes() {
  return createAttachmentsRoutes({
    authMiddleware,
    isSessionOwnedByUser,
  });
}

export function buildWebhooksRoutes() {
  return createWebhooksRoutes({
    createGithubWebhookService,
  });
}
