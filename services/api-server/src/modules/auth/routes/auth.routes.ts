import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "@repo/shared";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import type {
  AuthContext,
  AuthGitHubClient,
  AuthServiceError,
} from "../types/auth.types";
import { AuthService } from "../services/auth.service";
import { GitHubSignInFlowService } from "../services/github-sign-in-flow.service";
import {
  getMeRoute,
  postGithubInstallStartRoute,
  postGithubReauthStartRoute,
  postGithubReauthTokenRoute,
  postLogoutRoute,
  postNativeGithubSignInCompleteRoute,
  postNativeGithubSignInStartRoute,
  postNativeLogoutRoute,
  postNativeRefreshRoute,
  postWebGithubSignInCompleteRoute,
  postWebGithubSignInStartRoute,
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

/** Sign-in start failures are always client input problems. */
type SignInStartErrorCode = "INVALID_SIGN_IN_ATTEMPT" | "INVALID_ORIGIN" | "INVALID_RETURN_TO";

function startErrorCode(error: AuthServiceError): SignInStartErrorCode {
  return error.code === "INVALID_RETURN_TO" ? "INVALID_RETURN_TO" : "INVALID_ORIGIN";
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

  function createSignInFlowService(env: Env): GitHubSignInFlowService {
    return new GitHubSignInFlowService({
      env,
      github: createAuthGitHubClient(env),
      clearRepoListingSync: (userId) => deps.clearRepoListingSync(env, userId),
      logger,
    });
  }

  function requestLogFields(header: (name: string) => string | undefined) {
    return {
      requestId: header("cf-ray") ?? null,
      userAgent: header("user-agent") ?? null,
    };
  }

  /**
   * POST /auth/github/web/start — begins a web-bound GitHub sign-in attempt.
   *
   * The route, not a request field, binds the client type. The BFF keeps the
   * returned claim token in an HttpOnly cookie; it is never in a redirect URL.
   */
  authRoutes.openapi(postWebGithubSignInStartRoute, async (c) => {
    const { origin, returnTo } = c.req.valid("json");
    const result = await createSignInFlowService(c.env).startWeb({
      origin,
      returnTo,
      ...requestLogFields((name) => c.req.header(name)),
    });
    if (!result.ok) {
      return c.json(
        { error: result.error.message, code: startErrorCode(result.error) },
        400,
      );
    }

    return c.json(result.value, 200);
  });

  /**
   * POST /auth/github/web/complete — claims an identity-ready web attempt and
   * returns the opaque session token plus the server-selected next redirect.
   */
  authRoutes.openapi(postWebGithubSignInCompleteRoute, async (c) => {
    const { attemptId, claimToken } = c.req.valid("json");
    const result = await createSignInFlowService(c.env).completeWeb({
      attemptId,
      claimToken,
      ...requestLogFields((name) => c.req.header(name)),
    });
    if (!result.ok) {
      if (result.error.code === "SIGN_IN_NOT_READY") {
        return c.json(
          { error: result.error.message, code: "SIGN_IN_NOT_READY" as const },
          409,
        );
      }
      if (result.error.status === 500) {
        return c.json({ error: result.error.message }, 500);
      }
      return c.json(
        { error: result.error.message, code: "INVALID_SIGN_IN_ATTEMPT" as const },
        400,
      );
    }

    return c.json(result.value, 200);
  });

  /** POST /auth/github/native/start — begins a native-bound sign-in attempt. */
  authRoutes.openapi(postNativeGithubSignInStartRoute, async (c) => {
    const { redirectUri } = c.req.valid("json");
    const result = await createSignInFlowService(c.env).startNative({
      redirectUri,
      ...requestLogFields((name) => c.req.header(name)),
    });
    if (!result.ok) {
      return c.json(
        { error: result.error.message, code: startErrorCode(result.error) },
        400,
      );
    }

    return c.json(result.value, 200);
  });

  /**
   * POST /auth/github/native/complete — claims an identity-ready native
   * attempt. Returns `SIGN_IN_NOT_READY` while OAuth is still pending so a
   * browser dismissal before OAuth is not reported as a sign-in failure.
   */
  authRoutes.openapi(postNativeGithubSignInCompleteRoute, async (c) => {
    const { attemptId, claimToken } = c.req.valid("json");
    const result = await createSignInFlowService(c.env).completeNative({
      attemptId,
      claimToken,
      ...requestLogFields((name) => c.req.header(name)),
    });
    if (!result.ok) {
      if (result.error.code === "SIGN_IN_NOT_READY") {
        return c.json(
          { error: result.error.message, code: "SIGN_IN_NOT_READY" as const },
          409,
        );
      }
      if (result.error.status === 500) {
        return c.json({ error: result.error.message }, 500);
      }
      return c.json(
        { error: result.error.message, code: "INVALID_SIGN_IN_ATTEMPT" as const },
        400,
      );
    }

    return c.json(result.value, 200);
  });

  /**
   * GET /auth/callback — GitHub OAuth callback entry point.
   *
   * Sign-in attempts are completed server-side here; the authorization code is
   * never forwarded to a client. GitHub reauthorization still bounces its code
   * back to the originating web origin.
   */
  authRoutes.get("/callback", async (c) => {
    const authService = createAuthService(c.env);
    const result = await authService.createGitHubCallbackRedirect({
      code: c.req.query("code"),
      state: c.req.query("state"),
      oauthError: c.req.query("error"),
      ...requestLogFields((name) => c.req.header(name)),
    });
    if (!result.ok) {
      return c.text(result.error.message, result.error.status);
    }

    return c.redirect(result.value.redirectUrl, 302);
  });

  /**
   * GET /auth/github/install/callback — consumes the state forwarded by the
   * web setup page and returns to the flow's stored redirect target.
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
      ...requestLogFields((name) => c.req.header(name)),
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
      ...requestLogFields((name) => c.req.header(name)),
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
      ...requestLogFields((name) => c.req.header(name)),
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
