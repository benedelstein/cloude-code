import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Env } from "@/shared/types";
import type { AuthContext } from "@/shared/types/auth";
import type { FcmTokenRepository } from "../repositories/fcm-token.repository";
import { registerFcmTokenRoute } from "./notifications.schema";

type NotificationsRouteEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};

export interface NotificationsRouteDeps {
  authMiddleware: MiddlewareHandler<NotificationsRouteEnv>;
  createFcmTokenRepository(database: D1Database): FcmTokenRepository;
}

export function createNotificationsRoutes(
  deps: NotificationsRouteDeps,
): OpenAPIHono<NotificationsRouteEnv> {
  const routes = new OpenAPIHono<NotificationsRouteEnv>();

  routes.use("*", deps.authMiddleware);

  routes.openapi(registerFcmTokenRoute, async (c) => {
    const auth = c.get("auth");
    const request = c.req.valid("json");
    await deps.createFcmTokenRepository(c.env.DB).upsert({
      userId: auth.userId,
      deviceId: request.deviceId,
      token: request.token,
      platform: request.platform,
    });

    return c.json({ registered: true as const }, 200);
  });

  return routes;
}
