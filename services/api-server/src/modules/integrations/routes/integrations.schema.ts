import { createRoute, z } from "@hono/zod-openapi";
import {
  IntegrationLinkClaimRequest,
  IntegrationLinkClaimResponse,
  IntegrationSessionRequest,
  IntegrationSessionResponse,
} from "@repo/shared";

const ErrorResponse = z.object({ error: z.string() });

export const createIntegrationSessionRequestRoute = createRoute({
  method: "post",
  path: "/session-requests",
  request: {
    body: {
      content: { "application/json": { schema: IntegrationSessionRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: IntegrationSessionResponse } },
      description: "Integration session creation result",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Integration API token is invalid",
    },
  },
});

export const claimIntegrationLinkRoute = createRoute({
  method: "post",
  path: "/link/claim",
  request: {
    body: {
      content: { "application/json": { schema: IntegrationLinkClaimRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: IntegrationLinkClaimResponse } },
      description: "External integration account linked to the current Cloude user",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid or expired integration link token",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Authentication required",
    },
  },
});
