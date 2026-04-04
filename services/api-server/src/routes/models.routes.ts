import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  type AuthUser,
  authMiddleware,
} from "@/middleware/auth.middleware";
import { createLogger } from "@/lib/logger";
import { getProviderAuthService } from "@/lib/providers/runtime-registry";
import type { Env } from "@/types";
import {
  ModelsResponse,
  PROVIDER_LIST,
  type ProviderCatalogEntry,
} from "@repo/shared";

const getModelsRoute = createRoute({
  method: "get",
  path: "/",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: ModelsResponse } },
      description: "Provider-grouped model catalog with connection state",
    },
  },
});

export const modelsRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();
const logger = createLogger("models.routes.ts");

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
