import { createRoute, z } from "@hono/zod-openapi";
import {
  DiscordLinkClaimRequest,
  DiscordLinkClaimResponse,
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

export const claimDiscordLinkRoute = createRoute({
  method: "post",
  path: "/link/claim",
  request: {
    body: {
      content: { "application/json": { schema: DiscordLinkClaimRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: DiscordLinkClaimResponse } },
      description: "Discord account linked to the current Cloude user",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid or expired Discord link token",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Authentication required",
    },
  },
});
