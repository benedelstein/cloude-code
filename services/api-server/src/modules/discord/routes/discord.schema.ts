import { createRoute, z } from "@hono/zod-openapi";
import {
  DiscordSessionRequest,
  DiscordSessionResponse,
} from "@repo/shared";

const ErrorResponse = z.object({ error: z.string() });

export const createDiscordSessionRequestRoute = createRoute({
  method: "post",
  path: "/session-requests",
  request: {
    body: {
      content: { "application/json": { schema: DiscordSessionRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: DiscordSessionResponse } },
      description: "Discord session creation result",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Discord bot API token is invalid",
    },
  },
});
