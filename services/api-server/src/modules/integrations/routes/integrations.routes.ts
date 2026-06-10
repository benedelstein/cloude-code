import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { IntegrationSessionRequestService } from "../services/integration-session-request.service";
import type { AuthUser } from "@/shared/types/auth";
import type { Env } from "@/shared/types";
import { timingSafeCompare } from "@/shared/utils/crypto";
import {
  claimIntegrationLinkRoute,
  createIntegrationSessionRequestRoute,
  listIntegrationLinksRoute,
  revokeIntegrationLinkRoute,
} from "./integrations.schema";

const BEARER_PREFIX = "Bearer ";

type IntegrationsRouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export interface IntegrationsRoutesDeps {
  authMiddleware: MiddlewareHandler<IntegrationsRouteEnv>;
  createIntegrationSessionRequestService(env: Env): IntegrationSessionRequestService;
}

export function createIntegrationsRoutes(
  deps: IntegrationsRoutesDeps,
): OpenAPIHono<IntegrationsRouteEnv> {
  const integrationsRoutes = new OpenAPIHono<IntegrationsRouteEnv>();

  integrationsRoutes.openapi(createIntegrationSessionRequestRoute, async (c) => {
    const configuredToken = c.env.INTEGRATION_SESSION_REQUEST_TOKEN;
    const authHeader = c.req.header("Authorization");
    const bearerToken = authHeader?.startsWith(BEARER_PREFIX)
      ? authHeader.slice(BEARER_PREFIX.length)
      : null;
    if (!configuredToken || !bearerToken || !timingSafeCompare(bearerToken, configuredToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const service = deps.createIntegrationSessionRequestService(c.env);
    const response = await service.createSessionFromIntegration({
      request: c.req.valid("json"),
      executionCtx: c.executionCtx,
    });

    return c.json(response, 200);
  });

  integrationsRoutes.use("/links", deps.authMiddleware);
  integrationsRoutes.use("/links/*", deps.authMiddleware);
  integrationsRoutes.openapi(listIntegrationLinksRoute, async (c) => {
    const user = c.get("user");
    const service = deps.createIntegrationSessionRequestService(c.env);
    const response = await service.listIntegrationLinks({ userId: user.id });
    return c.json(response, 200);
  });

  integrationsRoutes.openapi(revokeIntegrationLinkRoute, async (c) => {
    const user = c.get("user");
    const service = deps.createIntegrationSessionRequestService(c.env);
    await service.revokeIntegrationLink({
      userId: user.id,
      provider: c.req.valid("param").provider,
    });
    return c.json({ ok: true as const }, 200);
  });

  integrationsRoutes.use("/link/claim", deps.authMiddleware);
  integrationsRoutes.openapi(claimIntegrationLinkRoute, async (c) => {
    const user = c.get("user");
    const service = deps.createIntegrationSessionRequestService(c.env);
    const result = await service.claimIntegrationLink({
      token: c.req.valid("json").token,
      userId: user.id,
    });

    if (!result.ok) {
      return c.json({ error: result.error.message }, result.error.status);
    }

    return c.json(result.value, 200);
  });

  return integrationsRoutes;
}
