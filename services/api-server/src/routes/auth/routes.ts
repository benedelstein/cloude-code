import { createRoute, z } from "@hono/zod-openapi";
import {
  GitHubAuthUrlResponse,
  TokenRequest,
  TokenResponse,
  UserInfo,
  LogoutResponse,
} from "@repo/shared";
import { authMiddleware } from "@/middleware/auth.middleware";

const ErrorResponse = z.object({
  error: z.string(),
});

const BounceTargetResponse = z.object({
  redirectOrigin: z.string(),
});

export const getGithubRoute = createRoute({
  method: "get",
  path: "/github",
  request: {
    query: z.object({
      // Optional origin to bounce back to after GitHub redirects to prod.
      // Must match the prod web origin or the preview allowlist regex.
      origin: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: GitHubAuthUrlResponse } },
      description: "GitHub OAuth authorization URL",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Origin is not allowed",
    },
  },
});

export const getBounceTargetRoute = createRoute({
  method: "get",
  path: "/bounce-target",
  request: {
    query: z.object({
      state: z.string().min(1),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: BounceTargetResponse } },
      description: "Recorded redirect origin for the given state token",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "State is unknown, expired, or maps to a non-allowed origin",
    },
  },
});

export const postTokenRoute = createRoute({
  method: "post",
  path: "/token",
  request: {
    body: {
      content: { "application/json": { schema: TokenRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: TokenResponse } },
      description: "Session token and user info",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Bad request",
    },
    403: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "User not allowed",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Failed to create user",
    },
  },
});

export const getMeRoute = createRoute({
  method: "get",
  path: "/me",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: UserInfo } },
      description: "Current user info",
    },
  },
});

export const postLogoutRoute = createRoute({
  method: "post",
  path: "/logout",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: LogoutResponse } },
      description: "Logout success",
    },
  },
});
