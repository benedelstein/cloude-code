import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Env } from "@/shared/types";
import { createLogger } from "@/shared/logging";
import {
  ClaudeOAuthError,
  getClaudeOAuthProvider,
} from "../services/provider-auth.service";
import type { AuthContext } from "@/shared/types/auth";
import {
  getClaudeAuthRoute,
  postClaudeTokenRoute,
  getClaudeStatusRoute,
  postClaudeDisconnectRoute,
} from "./claude.schema";

type ClaudeRouteEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};

export interface ClaudeAuthRouteDeps {
  authMiddleware: MiddlewareHandler<ClaudeRouteEnv>;
  requestSessionProviderConnectionRefresh(
    env: Env,
    sessionId: string,
    logger: ReturnType<typeof createLogger>,
  ): Promise<void>;
}

export function createClaudeAuthRoutes(
  deps: ClaudeAuthRouteDeps,
): OpenAPIHono<ClaudeRouteEnv> {
const claudeAuthRoutes = new OpenAPIHono<ClaudeRouteEnv>();
const logger = createLogger("claude.routes.ts");

claudeAuthRoutes.openapi(getClaudeAuthRoute, async (c) => {
  const claudeOAuthService = getClaudeOAuthProvider(c.env, logger);
  const authUrl = await claudeOAuthService.createAuthorizationUrl();
  return c.json(authUrl, 200);
});

claudeAuthRoutes.use("/claude/token", deps.authMiddleware);
claudeAuthRoutes.use("/claude/status", deps.authMiddleware);
claudeAuthRoutes.use("/claude/disconnect", deps.authMiddleware);

claudeAuthRoutes.openapi(postClaudeTokenRoute, async (c) => {
  const { code, state, sessionId } = c.req.valid("json");
  const auth = c.get("auth");
  const claudeOAuthService = getClaudeOAuthProvider(c.env, logger);

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  try {
    await claudeOAuthService.exchangeAuthorizationCode({
      userId: auth.userId,
      code,
      state,
    });
    if (sessionId) {
      await deps.requestSessionProviderConnectionRefresh(c.env, sessionId, logger);
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
  const auth = c.get("auth");
  const claudeOAuthService = getClaudeOAuthProvider(c.env, logger);
  const status = await claudeOAuthService.getConnectionStatus(auth.userId);
  return c.json(status, 200);
});

claudeAuthRoutes.openapi(postClaudeDisconnectRoute, async (c) => {
  const auth = c.get("auth");
  const claudeOAuthService = getClaudeOAuthProvider(c.env, logger);
  await claudeOAuthService.disconnect(auth.userId);
  return c.json({ ok: true as const }, 200);
});

return claudeAuthRoutes;
}
