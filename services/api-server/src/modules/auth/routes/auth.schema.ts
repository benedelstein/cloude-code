import { createRoute, z } from "@hono/zod-openapi";
import {
  GitHubAuthUrlResponse,
  GitHubReauthTokenResponse,
  NativeLogoutRequest,
  NativeLoginContinuationRequest,
  NativeTokenRequest,
  NativeTokenResponse,
  RefreshRequest,
  RefreshResponse,
  TokenRequest,
  TokenResponse,
  UserInfo,
  LogoutResponse,
} from "@repo/shared";

const ErrorResponse = z.object({
  error: z.string(),
});

export const getGithubRoute = createRoute({
  method: "get",
  path: "/github",
  request: {
    query: z.object({
      // Optional origin to bounce back to after GitHub redirects to prod.
      // Must match the configured web origin, a dev loopback origin, or the
      // preview allowlist regex.
      origin: z.string().optional(),
      // Native clients only: a custom-scheme redirect URI (exact-matched
      // against a hardcoded allowlist) that the OAuth callback 302s to.
      // Mutually exclusive with `origin`.
      redirectUri: z.string().optional(),
      // Native clients can keep OAuth and GitHub App installation inside one
      // browser session while retaining separate callback contracts.
      continueToInstallation: z.coerce.boolean().optional(),
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

export const postGithubReauthStartRoute = createRoute({
  method: "post",
  path: "/github/reauth/start",
  request: {
    query: z.object({
      origin: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: GitHubAuthUrlResponse } },
      description: "GitHub OAuth authorization URL for reconnecting credentials",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Origin is not allowed",
    },
  },
});

export const postGithubInstallStartRoute = createRoute({
  method: "post",
  path: "/github/install/start",
  request: {
    query: z.object({
      redirectUri: z.string(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: GitHubAuthUrlResponse } },
      description: "One-time GitHub App installation URL for a native client",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Native redirect URI is not allowed",
    },
  },
});

export const postGithubReauthTokenRoute = createRoute({
  method: "post",
  path: "/github/reauth/token",
  request: {
    body: {
      content: { "application/json": { schema: TokenRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: GitHubReauthTokenResponse } },
      description: "GitHub credentials refreshed for current app user",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Bad request",
    },
    403: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "GitHub account does not match the current app user",
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

export const postNativeTokenRoute = createRoute({
  method: "post",
  path: "/native/token",
  request: {
    body: {
      content: { "application/json": { schema: NativeTokenRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: NativeTokenResponse } },
      description: "Native JWT access token, refresh token, and user info",
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

export const postNativeLoginContinuationRoute = createRoute({
  method: "post",
  path: "/native/complete",
  request: {
    body: {
      content: { "application/json": { schema: NativeLoginContinuationRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: NativeTokenResponse } },
      description: "Native session completed after OAuth and optional GitHub App installation",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Continuation is not ready, invalid, or expired",
    },
  },
});

export const postNativeRefreshRoute = createRoute({
  method: "post",
  path: "/native/refresh",
  request: {
    body: {
      content: { "application/json": { schema: RefreshRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: RefreshResponse } },
      description: "Rotated access/refresh token pair",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid, expired, or reused refresh token",
    },
  },
});

export const postNativeLogoutRoute = createRoute({
  method: "post",
  path: "/native/logout",
  request: {
    body: {
      content: { "application/json": { schema: NativeLogoutRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: LogoutResponse } },
      description: "Native logout success",
    },
  },
});

export const getMeRoute = createRoute({
  method: "get",
  path: "/me",
  responses: {
    200: {
      content: { "application/json": { schema: UserInfo } },
      description: "Current user info",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "User not found",
    },
  },
});

export const postLogoutRoute = createRoute({
  method: "post",
  path: "/logout",
  responses: {
    200: {
      content: { "application/json": { schema: LogoutResponse } },
      description: "Logout success",
    },
  },
});
