import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "@repo/shared";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import type { AuthContext } from "../types/auth.types";
import { AuthService, type AuthGitHubClient } from "../services/auth.service";
import {
  getGithubRoute,
  postGithubInstallStartRoute,
  postGithubReauthStartRoute,
  postGithubReauthTokenRoute,
  postTokenRoute,
  postNativeTokenRoute,
  postNativeLoginContinuationRoute,
  postNativeRefreshRoute,
  postNativeLogoutRoute,
  getMeRoute,
  postLogoutRoute,
} from "./auth.schema";

type AuthRouteEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};

export interface AuthRouteDeps {
  authMiddleware: MiddlewareHandler<AuthRouteEnv>;
  createGitHubClient(env: Env, logger: Logger): AuthGitHubClient;
  clearRepoListingSync(env: Env, userId: string): Promise<void>;
}

export function createAuthRoutes(
  deps: AuthRouteDeps,
): OpenAPIHono<AuthRouteEnv> {
  const authRoutes = new OpenAPIHono<AuthRouteEnv>();
  const logger = createLogger("auth.routes.ts");

  function createAuthGitHubClient(env: Env): AuthGitHubClient {
    return deps.createGitHubClient(env, logger);
  }

  function createAuthService(env: Env): AuthService {
    return new AuthService({
      env,
      github: createAuthGitHubClient(env),
      clearRepoListingSync: (userId) => deps.clearRepoListingSync(env, userId),
      logger,
    });
  }

  /**
   * GET auth/github — returns the install + authorize URL.
   *
   * Accepts an optional `origin` query param. The caller's window origin is
   * recorded against the state nonce so the prod bouncer can 302 the OAuth code
   * back to a Vercel preview branch after GitHub's callback. Origin is validated
   * against the prod web origin or the preview allowlist regex before being
   * stored.
   *
   * @returns The install + authorize URL and the nonce token
   */
  authRoutes.openapi(getGithubRoute, async (c) => {
    const {
      origin: requestedOrigin,
      redirectUri,
      continueToInstallation,
    } = c.req.valid("query");
    const authService = createAuthService(c.env);
    const result = await authService.createGitHubAuthorizationUrl({
      requestedOrigin,
      nativeRedirectUri: redirectUri,
      continueToInstallation,
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (!result.ok) {
      return c.json({ error: result.error.message }, 400);
    }

    return c.json(result.value, 200);
  });

  /**
   * GET /auth/callback — GitHub OAuth callback entry point.
   *
   * GitHub redirects the popup here with `code` and `state`. The service peeks
   * the state's recorded origin without consuming the row; single-use
   * consumption still happens in /auth/token.
   */
  authRoutes.get("/callback", async (c) => {
    const authService = createAuthService(c.env);
    const result = await authService.createGitHubCallbackRedirect({
      code: c.req.query("code"),
      state: c.req.query("state"),
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (!result.ok) {
      return c.text(result.error.message, result.error.status);
    }

    return c.redirect(result.value.redirectUrl, 302);
  });

  /**
   * GET /auth/github/install/callback — consumes the state forwarded by the
   * web setup page and returns to the native app's allowlisted custom scheme.
   */
  authRoutes.get("/github/install/callback", async (c) => {
    const authService = createAuthService(c.env);
    const result = await authService.createGitHubInstallationCallbackRedirect({
      state: c.req.query("state"),
    });
    if (!result.ok) {
      return c.text(result.error.message, result.error.status);
    }

    return c.redirect(result.value.redirectUrl, 302);
  });

  /**
   * POST /auth/token — exchange code for session token
   * the code is returned by github
   * @param code - The OAuth code to exchange
   * @param state - The state/nonce token to validate
   * @returns The session token and user info
   */
  authRoutes.openapi(postTokenRoute, async (c) => {
    const { code, state } = c.req.valid("json");
    const authService = createAuthService(c.env);
    const result = await authService.exchangeGitHubAuthorizationCode({
      code,
      state,
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (!result.ok) {
      return c.json(
        { error: result.error.message },
        result.error.status === 500 ? 500 : 400,
      );
    }

    return c.json(result.value, 200);
  });

  /**
   * POST /auth/native/token — exchange code for a native JWT access token and
   * opaque rotating refresh token.
   */
  authRoutes.openapi(postNativeTokenRoute, async (c) => {
    const { code, state } = c.req.valid("json");
    const authService = createAuthService(c.env);
    const result = await authService.exchangeNativeGitHubAuthorizationCode({
      code,
      state,
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (!result.ok) {
      return c.json(
        { error: result.error.message },
        result.error.status === 500 ? 500 : 400,
      );
    }

    return c.json(result.value, 200);
  });

  authRoutes.openapi(postNativeLoginContinuationRoute, async (c) => {
    const { state, token } = c.req.valid("json");
    const authService = createAuthService(c.env);
    const result = await authService.completeNativeGitHubLogin({
      state,
      token,
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (!result.ok) {
      return c.json({ error: result.error.message }, 400);
    }

    return c.json(result.value, 200);
  });

  /**
   * POST /auth/native/refresh — rotate a native access/refresh token pair.
   * No auth middleware: the refresh token in the body is the credential.
   */
  authRoutes.openapi(postNativeRefreshRoute, async (c) => {
    const { refreshToken } = c.req.valid("json");
    const authService = createAuthService(c.env);
    const result = await authService.refreshSession(refreshToken);
    if (!result.ok) {
      return c.json({ error: result.error.message }, 401);
    }

    return c.json(result.value, 200);
  });

  /**
   * POST /auth/native/logout — revoke the native refresh-token family.
   * No auth middleware: the refresh token in the body is the credential.
   */
  authRoutes.openapi(postNativeLogoutRoute, async (c) => {
    const { refreshToken } = c.req.valid("json");
    const authService = createAuthService(c.env);
    return c.json(await authService.logoutNative(refreshToken), 200);
  });

  authRoutes.use("/github/reauth/*", deps.authMiddleware);

  authRoutes.use("/github/install/start", deps.authMiddleware);
  authRoutes.openapi(postGithubInstallStartRoute, async (c) => {
    const { redirectUri } = c.req.valid("query");
    const auth = c.get("auth");
    const authService = createAuthService(c.env);
    const result = await authService.createGitHubInstallationUrl({
      userId: auth.userId,
      nativeRedirectUri: redirectUri,
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (!result.ok) {
      return c.json({ error: result.error.message }, 400);
    }

    return c.json(result.value, 200);
  });

  authRoutes.openapi(postGithubReauthStartRoute, async (c) => {
    const { origin: requestedOrigin } = c.req.valid("query");
    const auth = c.get("auth");
    const authService = createAuthService(c.env);
    const result = await authService.createGitHubReauthAuthorizationUrl({
      userId: auth.userId,
      requestedOrigin,
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (!result.ok) {
      return c.json({ error: result.error.message }, 400);
    }

    return c.json(result.value, 200);
  });

  authRoutes.openapi(postGithubReauthTokenRoute, async (c) => {
    const { code, state } = c.req.valid("json");
    const auth = c.get("auth");
    const authService = createAuthService(c.env);
    const result = await authService.exchangeGitHubReauthCode({
      userId: auth.userId,
      code,
      state,
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    if (!result.ok) {
      return c.json(
        { error: result.error.message },
        result.error.status === 403 ? 403 : 400,
      );
    }

    return c.json(result.value, 200);
  });

  // GET /auth/me — returns current user info
  authRoutes.use("/me", deps.authMiddleware);
  authRoutes.openapi(getMeRoute, async (c) => {
    const auth = c.get("auth");
    const authService = createAuthService(c.env);
    const result = await authService.getCurrentUser(auth.userId);
    if (!result.ok) {
      return c.json({ error: result.error.message }, 401);
    }

    return c.json(result.value, 200);
  });

  // POST /auth/logout — deletes auth session
  authRoutes.use("/logout", deps.authMiddleware);
  authRoutes.openapi(postLogoutRoute, async (c) => {
    const authHeader = c.req.header("Authorization")!;
    const token = authHeader.slice(7);
    const authService = createAuthService(c.env);
    return c.json(await authService.logout(token), 200);
  });

  return authRoutes;
}
