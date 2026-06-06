import { OpenAPIHono } from "@hono/zod-openapi";
import type { DiscordSessionRequestService } from "../services/discord-session-request.service";
import type { Env } from "@/shared/types";
import { createDiscordSessionRequestRoute } from "./discord.schema";

type DiscordRouteEnv = {
  Bindings: Env;
};

export interface DiscordRoutesDeps {
  createDiscordSessionRequestService(env: Env): DiscordSessionRequestService;
}

export function createDiscordRoutes(
  deps: DiscordRoutesDeps,
): OpenAPIHono<DiscordRouteEnv> {
  const discordRoutes = new OpenAPIHono<DiscordRouteEnv>();

  discordRoutes.use("*", async (c, next) => {
    const configuredToken = c.env.DISCORD_SESSION_REQUEST_TOKEN;
    const authHeader = c.req.header("Authorization");
    if (!configuredToken || authHeader !== `Bearer ${configuredToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  discordRoutes.openapi(createDiscordSessionRequestRoute, async (c) => {
    const service = deps.createDiscordSessionRequestService(c.env);
    const response = await service.createSessionFromDiscord({
      request: c.req.valid("json"),
      executionCtx: c.executionCtx,
    });

    return c.json(response, 200);
  });

  return discordRoutes;
}
