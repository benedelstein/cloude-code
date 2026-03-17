import { createRoute, z } from "@hono/zod-openapi";
import {
  GitHubAuthUrlRequest,
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

export const getGithubRoute = createRoute({
  method: "get",
  path: "/github",
  request: {
    query: GitHubAuthUrlRequest,
  },
  responses: {
    200: {
      content: { "application/json": { schema: GitHubAuthUrlResponse } },
      description: "GitHub OAuth authorization URL",
    },
  },
});

export const getGithubCallbackRoute = createRoute({
  method: "get",
  path: "/github/callback",
  request: {
    query: z.object({
      code: z.string(),
      state: z.string(),
    }),
  },
  responses: {
    302: {
      description: "Redirect to frontend callback with code and state",
    },
    400: {
      content: { "text/plain": { schema: z.string() } },
      description: "Invalid or expired state",
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
