import { createRoute } from "@hono/zod-openapi";
import {
  GitHubAuthUrlResponse,
  TokenRequest,
  TokenResponse,
  UserInfo,
  LogoutResponse,
} from "@repo/shared";
import { authMiddleware } from "@/middleware/auth.middleware";

export const getGithubRoute = createRoute({
  method: "get",
  path: "/github",
  responses: {
    200: {
      content: { "application/json": { schema: GitHubAuthUrlResponse } },
      description: "GitHub OAuth authorization URL",
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
