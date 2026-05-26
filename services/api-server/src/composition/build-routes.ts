import { createClaudeAuthRoutes } from "@/modules/ai-auth/routes/claude.routes";
import { createModelsRoutes } from "@/modules/ai-auth/routes/models.routes";
import { createOpenAIAuthRoutes } from "@/modules/ai-auth/routes/openai.routes";
import { createAttachmentsRoutes } from "@/modules/attachments/routes/attachments.routes";
import { AttachmentService } from "@/modules/attachments/services/attachment.service";
import { createAuthRoutes } from "@/modules/auth/routes/auth.routes";
import { createAuthMiddleware } from "@/modules/auth/middleware/auth.middleware";
import { UserSessionService } from "@/modules/auth/services/user-session.service";
import { GitHubAppService } from "@/modules/github/services/github-app.service";
import { ReposService } from "@/modules/github/services/repo-listing.service";
import { createReposRoutes } from "@/modules/repos/routes/repos.routes";
import { createAgentRoutes } from "@/modules/session-agent/routes/agent.routes";
import { createGitProxyRoutes } from "@/modules/session-agent/routes/git-proxy.routes";
import { createInternalRoutes } from "@/modules/session-agent/routes/internal.routes";
import { createSessionsRoutes } from "@/modules/sessions/routes/sessions.routes";
import { SessionsService } from "@/modules/sessions/services/sessions.service";
import { requestSessionAccessBlockedCleanup } from "@/modules/sessions/services/session-access-block.service";
import { assertSessionRepoAccess } from "@/modules/sessions/services/session-repo-access.service";
import { isSessionOwnedByUser } from "@/modules/sessions/services/session-access.service";
import { requestSessionProviderConnectionRefresh } from "@/modules/sessions/services/session-provider-connection.service";
import { verifySessionWebSocketToken } from "@/modules/sessions/services/session-websocket-token.service";
import { createWebhooksRoutes } from "@/modules/webhooks/routes/webhooks.routes";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import { createGitHubWebhookHandler } from "./providers/create-github-webhook-handler";

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

const authMiddleware = createAuthMiddleware((env, token) =>
  createUserSessionService(env).getAuthenticatedUserBySessionToken(token),
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
  });
}

export function buildSessionsRoutes() {
  return createSessionsRoutes({
    authMiddleware,
    createSessionsService: (env) =>
      new SessionsService({
        env,
        attachmentProvider: new AttachmentService(env.DB),
        repoAccessProviders: createRepoAccessProviders(env),
        createPullRequestGitHubProvider: () =>
          createGitHubAppService(env, "sessions.service.ts"),
      }),
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
    createGitHubWebhookHandler,
  });
}
