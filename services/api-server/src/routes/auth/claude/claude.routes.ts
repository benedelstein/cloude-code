import { OpenAPIHono } from "@hono/zod-openapi";
import { getAgentByName } from "agents";
import type { Env } from "@/types";
import { logger } from "@/lib/logger";
import {
  ClaudeOAuthError,
  ClaudeOAuthService,
} from "@/lib/claude-oauth-service";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import { SessionHistoryService } from "@/lib/session-history";
import type { AuthUser } from "@/middleware/auth.middleware";
import {
  getClaudeAuthRoute,
  postClaudeTokenRoute,
  getClaudeStatusRoute,
  postClaudeDisconnectRoute,
} from "./schemas";

export const claudeAuthRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

claudeAuthRoutes.openapi(getClaudeAuthRoute, async (c) => {
  const claudeOAuthService = new ClaudeOAuthService(c.env, logger);
  const authUrl = await claudeOAuthService.createAuthorizationUrl();
  return c.json(authUrl, 200);
});

claudeAuthRoutes.openapi(postClaudeTokenRoute, async (c) => {
  const { code, state, sessionId } = c.req.valid("json");
  const user = c.get("user");
  const claudeOAuthService = new ClaudeOAuthService(c.env, logger);

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  try {
    await claudeOAuthService.exchangeAuthorizationCode({
      userId: user.id,
      code,
      state,
    });

    if (sessionId) {
      const sessionHistory = new SessionHistoryService(c.env.DB);
      const isOwnedByUser = await sessionHistory.isOwnedByUser(sessionId, user.id);
      if (isOwnedByUser) {
        const sessionAgent = await getAgentByName<Env, SessionAgentDO>(
          c.env.SESSION_AGENT,
          sessionId,
        );
        const refreshResponse = await sessionAgent.fetch(
          new Request("http://do/claude-auth/refresh", { method: "POST" }),
        );

        if (!refreshResponse.ok) {
          logger.error("Failed to refresh Claude auth state for session", {
            loggerName: "claude.routes.ts",
            fields: { sessionId, userId: user.id, status: refreshResponse.status },
          });
        }
      } else {
        logger.warn("Skipping Claude auth refresh for unauthorized session", {
          loggerName: "claude.routes.ts",
          fields: { sessionId, userId: user.id },
        });
      }
    }
  } catch (error) {
    logger.error("Claude token exchange error", { loggerName: "claude.routes.ts", error });
    if (error instanceof ClaudeOAuthError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Failed to exchange code" }, 400);
  }

  return c.json({ ok: true as const }, 200);
});

claudeAuthRoutes.openapi(getClaudeStatusRoute, async (c) => {
  const user = c.get("user");
  const claudeOAuthService = new ClaudeOAuthService(c.env, logger);
  const status = await claudeOAuthService.getConnectionStatus(user.id);
  return c.json(status, 200);
});

claudeAuthRoutes.openapi(postClaudeDisconnectRoute, async (c) => {
  const user = c.get("user");
  const claudeOAuthService = new ClaudeOAuthService(c.env, logger);
  await claudeOAuthService.disconnect(user.id);
  return c.json({ ok: true as const }, 200);
});
