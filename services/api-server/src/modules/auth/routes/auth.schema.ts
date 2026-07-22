import { createRoute, z } from "@hono/zod-openapi";
import {
  GitHubAuthUrlResponse,
  GitHubReauthTokenResponse,
  GitHubSignInCompleteRequest,
  GitHubSignInStartResponse,
  NativeGitHubSignInCompleteResponse,
  NativeGitHubSignInStartRequest,
  NativeLogoutRequest,
  RefreshRequest,
  RefreshResponse,
  TokenRequest,
  UserInfo,
  LogoutResponse,
  WebGitHubSignInCompleteResponse,
  WebGitHubSignInStartRequest,
} from "@repo/shared";

const ErrorResponse = z.object({
  error: z.string(),
});

/** Sign-in failures expose one stable invalid-attempt result. */
const SignInErrorResponse = z.object({
  error: z.string(),
  code: z.enum(["INVALID_SIGN_IN_ATTEMPT", "INVALID_ORIGIN", "INVALID_RETURN_TO"]),
});

export const postWebGithubSignInStartRoute = createRoute({
  method: "post",
  path: "/github/web/start",
  request: {
    body: {
      content: { "application/json": { schema: WebGitHubSignInStartRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: GitHubSignInStartResponse } },
      description: "Web-bound GitHub sign-in attempt",
    },
    400: {
      content: { "application/json": { schema: SignInErrorResponse } },
      description: "Origin or return path is not allowed",
    },
  },
});

export const postWebGithubSignInCompleteRoute = createRoute({
  method: "post",
  path: "/github/web/complete",
  request: {
    body: {
      content: { "application/json": { schema: GitHubSignInCompleteRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: WebGitHubSignInCompleteResponse } },
      description: "Opaque web session token, user, and next redirect",
    },
    400: {
      content: { "application/json": { schema: SignInErrorResponse } },
      description: "Attempt is invalid, expired, already claimed, or not web-bound",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Signed-in user could not be loaded",
    },
  },
});

export const postNativeGithubSignInStartRoute = createRoute({
  method: "post",
  path: "/github/native/start",
  request: {
    body: {
      content: { "application/json": { schema: NativeGitHubSignInStartRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: GitHubSignInStartResponse } },
      description: "Native-bound GitHub sign-in attempt",
    },
    400: {
      content: { "application/json": { schema: SignInErrorResponse } },
      description: "Native redirect URI is not allowed",
    },
  },
});

export const postNativeGithubSignInCompleteRoute = createRoute({
  method: "post",
  path: "/github/native/complete",
  request: {
    body: {
      content: { "application/json": { schema: GitHubSignInCompleteRequest } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: NativeGitHubSignInCompleteResponse },
      },
      description: "Native access/refresh token pair and user",
    },
    400: {
      content: { "application/json": { schema: SignInErrorResponse } },
      description: "Attempt is invalid, expired, already claimed, or not native-bound",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Signed-in user could not be loaded",
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
