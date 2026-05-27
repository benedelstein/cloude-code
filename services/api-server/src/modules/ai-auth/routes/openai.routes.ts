import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Env } from "@/shared/types";
import { createLogger } from "@/shared/logging";
import type { AuthUser } from "@/shared/types/auth";
import { getOpenAICodexAuthProvider } from "../services/provider-auth.service";
import {
  postOpenAIDeviceStartRoute,
  getOpenAIDeviceAttemptRoute,
  getOpenAIStatusRoute,
  postOpenAIDisconnectRoute,
} from "./openai.schema";

type OpenAIRouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export interface OpenAIAuthRouteDeps {
  authMiddleware: MiddlewareHandler<OpenAIRouteEnv>;
  requestSessionProviderConnectionRefresh(
    env: Env,
    sessionId: string,
    logger: ReturnType<typeof createLogger>,
  ): Promise<void>;
}

export function createOpenAIAuthRoutes(
  deps: OpenAIAuthRouteDeps,
): OpenAPIHono<OpenAIRouteEnv> {
const openaiAuthRoutes = new OpenAPIHono<OpenAIRouteEnv>();
const logger = createLogger("openai.routes.ts");

openaiAuthRoutes.use("*", deps.authMiddleware);

/**
 * POST /auth/openai/device/start — Start device-code authorization.
 */
openaiAuthRoutes.openapi(postOpenAIDeviceStartRoute, async (c) => {
  const user = c.get("user");
  const openAICodexAuthService = getOpenAICodexAuthProvider(c.env, logger);

  const result = await openAICodexAuthService.startDeviceAuthorization(user.id);
  if (!result.ok) {
    logger.error("OpenAI Codex device auth start error", { error: result.error });
    switch (result.error.status) {
      case 400:
      case 403:
      case 404:
      case 502:
        return c.json({ error: result.error.message }, result.error.status);
      default:
        return c.json({ error: result.error.message }, 502);
    }
  }
  return c.json(result.value, 200);
});

/**
 * GET /auth/openai/device/attempts/:attemptId — Poll device-code authorization.
 */
openaiAuthRoutes.openapi(getOpenAIDeviceAttemptRoute, async (c) => {
  const user = c.get("user");
  const { attemptId } = c.req.valid("param");
  const { sessionId } = c.req.valid("query");
  const openAICodexAuthService = getOpenAICodexAuthProvider(c.env, logger);
  const result = await openAICodexAuthService.pollDeviceAuthorization(user.id, attemptId);
  if (result.status === "completed" && sessionId) {
    await deps.requestSessionProviderConnectionRefresh(c.env, sessionId, logger);
  }
  return c.json(result, 200);
});

/**
 * GET /auth/openai/status — Check if user has connected OpenAI
 */
openaiAuthRoutes.openapi(getOpenAIStatusRoute, async (c) => {
  const user = c.get("user");
  const openAICodexAuthService = getOpenAICodexAuthProvider(c.env, logger);
  const status = await openAICodexAuthService.getConnectionStatus(user.id);
  return c.json(status, 200);
});

/**
 * POST /auth/openai/disconnect — Remove OpenAI tokens
 */
openaiAuthRoutes.openapi(postOpenAIDisconnectRoute, async (c) => {
  const user = c.get("user");
  const openAICodexAuthService = getOpenAICodexAuthProvider(c.env, logger);
  await openAICodexAuthService.disconnect(user.id);
  return c.json({ ok: true as const }, 200);
});

return openaiAuthRoutes;
}
