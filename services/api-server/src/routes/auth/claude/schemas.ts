import { z } from "zod";
import { createRoute } from "@hono/zod-openapi";
import {
  ClaudeAuthUrlResponse,
  ClaudeTokenRequest,
  ClaudeTokenResponse,
  ClaudeStatusResponse,
  ClaudeDisconnectResponse,
} from "@repo/shared";
import { authMiddleware } from "@/middleware/auth.middleware";

const ErrorResponse = z.object({
  error: z.string(),
});

export const getClaudeAuthRoute = createRoute({
  method: "get",
  path: "/claude",
  responses: {
    200: {
      content: { "application/json": { schema: ClaudeAuthUrlResponse } },
      description: "Claude OAuth authorization URL with PKCE",
    },
  },
});

export const postClaudeTokenRoute = createRoute({
  method: "post",
  path: "/claude/token",
  middleware: [authMiddleware] as const,
  description: "Exchange Claude OAuth code for tokens",
  request: {
    body: {
      content: { "application/json": { schema: ClaudeTokenRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: ClaudeTokenResponse } },
      description: "Token exchange success",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Bad request",
    },
  },
});

export const getClaudeStatusRoute = createRoute({
  method: "get",
  path: "/claude/status",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: ClaudeStatusResponse } },
      description: "Claude connection status",
    },
  },
});

export const postClaudeDisconnectRoute = createRoute({
  method: "post",
  path: "/claude/disconnect",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: ClaudeDisconnectResponse } },
      description: "Disconnect success",
    },
  },
});
