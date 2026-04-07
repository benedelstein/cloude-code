import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "@/types";
import { createLogger } from "@/lib/logger";
import {
  ClaudeOAuthError,
  ClaudeOAuthService,
} from "@/lib/providers/claude-oauth-service";
import type { AuthUser } from "@/middleware/auth.middleware";
import {
  getClaudeAuthRoute,
  postClaudeTokenRoute,
  getClaudeStatusRoute,
  postClaudeDisconnectRoute,
} from "./schemas";
import { requestSessionProviderConnectionRefresh } from "@/lib/session-provider-connection";

export const claudeAuthRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();
const logger = createLogger("claude.routes.ts");

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
      await requestSessionProviderConnectionRefresh(c.env, sessionId, logger);
    }
  } catch (error) {
    logger.error("Claude token exchange error", { error });
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
