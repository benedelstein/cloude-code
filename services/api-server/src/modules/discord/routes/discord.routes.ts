import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { DiscordSessionRequestService } from "../services/discord-session-request.service";
import type { AuthUser } from "@/shared/types/auth";
import type { Env } from "@/shared/types";
import {
  claimDiscordLinkRoute,
  createDiscordSessionRequestRoute,
} from "./discord.schema";

type DiscordRouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export interface DiscordRoutesDeps {
  authMiddleware: MiddlewareHandler<DiscordRouteEnv>;
  createDiscordSessionRequestService(env: Env): DiscordSessionRequestService;
}

export function createDiscordRoutes(
  deps: DiscordRoutesDeps,
): OpenAPIHono<DiscordRouteEnv> {
  const discordRoutes = new OpenAPIHono<DiscordRouteEnv>();

  discordRoutes.openapi(createDiscordSessionRequestRoute, async (c) => {
    const configuredToken = c.env.DISCORD_SESSION_REQUEST_TOKEN;
    const authHeader = c.req.header("Authorization");
    if (!configuredToken || authHeader !== `Bearer ${configuredToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const service = deps.createDiscordSessionRequestService(c.env);
    const response = await service.createSessionFromDiscord({
      request: c.req.valid("json"),
      executionCtx: c.executionCtx,
    });

    return c.json(response, 200);
  });

  discordRoutes.use("/link/claim", deps.authMiddleware);
  discordRoutes.openapi(claimDiscordLinkRoute, async (c) => {
    const user = c.get("user");
    const service = deps.createDiscordSessionRequestService(c.env);
    const result = await service.claimDiscordLink({
      token: c.req.valid("json").token,
      userId: user.id,
    });

    if (!result.ok) {
      return c.json({ error: result.error.message }, result.error.status);
    }

    return c.json(result.value, 200);
  });

  return discordRoutes;
}
