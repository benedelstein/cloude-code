import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { AuthUser } from "@/shared/types/auth";
import { createLogger } from "@/shared/logging";
import { getProviderAuthService } from "../services/provider-auth.service";
import type { Env } from "@/shared/types";
import {
  ModelsResponse,
  PROVIDER_LIST,
  type ProviderCatalogEntry,
} from "@repo/shared";

const getModelsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: ModelsResponse } },
      description: "Provider-grouped model catalog with connection state",
    },
  },
});

type ModelsRouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export interface ModelsRouteDeps {
  authMiddleware: MiddlewareHandler<ModelsRouteEnv>;
}

export function createModelsRoutes(deps: ModelsRouteDeps): OpenAPIHono<ModelsRouteEnv> {
const modelsRoutes = new OpenAPIHono<ModelsRouteEnv>();
const logger = createLogger("models.routes.ts");

modelsRoutes.use("*", deps.authMiddleware);

modelsRoutes.openapi(getModelsRoute, async (c) => {
  const user = c.get("user");
  const providers: ProviderCatalogEntry[] = [];

  for (const provider of PROVIDER_LIST) {
    const service = getProviderAuthService(provider.id, c.env, logger);
    // todo: parallel
    const status = await service.getConnectionStatus(user.id);

    providers.push({
      providerId: provider.id,
      providerName: provider.displayName,
      connected: status.connected,
      requiresReauth: status.requiresReauth,
      defaultModel: provider.defaultModel,
      authMethods: provider.authMethods,
      models: provider.models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        isDefault: model.isDefault,
        selectable: status.connected,
      })),
    });
  }

  return c.json({ providers }, 200);
});

return modelsRoutes;
}
