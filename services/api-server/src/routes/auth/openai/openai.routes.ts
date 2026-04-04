import { OpenAPIHono } from "@hono/zod-openapi";
import type { Env } from "@/types";
import { createLogger } from "@/lib/logger";
import {
  type AuthUser,
} from "@/middleware/auth.middleware";
import { OpenAICodexAuthError, OpenAICodexAuthService } from "@/lib/openai-codex-auth-service";
import {
  postOpenAIDeviceStartRoute,
  getOpenAIDeviceAttemptRoute,
  getOpenAIStatusRoute,
  postOpenAIDisconnectRoute,
} from "./schemas";

export const openaiAuthRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();
const logger = createLogger("openai.routes.ts");

/**
 * POST /auth/openai/device/start — Start device-code authorization.
 */
openaiAuthRoutes.openapi(postOpenAIDeviceStartRoute, async (c) => {
  const user = c.get("user");
  const openAICodexAuthService = new OpenAICodexAuthService(c.env, logger);

  try {
    const result = await openAICodexAuthService.startDeviceAuthorization(user.id);
    return c.json(result, 200);
  } catch (error) {
    logger.error("OpenAI Codex device auth start error", { error });
    if (error instanceof OpenAICodexAuthError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: "Failed to start device authorization" }, 400);
  }
});

/**
 * GET /auth/openai/device/attempts/:attemptId — Poll device-code authorization.
 */
openaiAuthRoutes.openapi(getOpenAIDeviceAttemptRoute, async (c) => {
  const user = c.get("user");
  const { attemptId } = c.req.valid("param");
  const openAICodexAuthService = new OpenAICodexAuthService(c.env, logger);
  const result = await openAICodexAuthService.pollDeviceAuthorization(user.id, attemptId);
  return c.json(result, 200);
});

/**
 * GET /auth/openai/status — Check if user has connected OpenAI
 */
openaiAuthRoutes.openapi(getOpenAIStatusRoute, async (c) => {
  const user = c.get("user");
  const openAICodexAuthService = new OpenAICodexAuthService(c.env, logger);
  const status = await openAICodexAuthService.getConnectionStatus(user.id);
  return c.json(status, 200);
});

/**
 * POST /auth/openai/disconnect — Remove OpenAI tokens
 */
openaiAuthRoutes.openapi(postOpenAIDisconnectRoute, async (c) => {
  const user = c.get("user");
  const openAICodexAuthService = new OpenAICodexAuthService(c.env, logger);
  await openAICodexAuthService.disconnect(user.id);
  return c.json({ ok: true as const }, 200);
});
