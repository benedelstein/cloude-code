import { OpenAPIHono } from "@hono/zod-openapi";
import { Octokit } from "octokit";
import type { Env } from "@/types";
import { GitHubAppService } from "@/lib/github";
import { logger } from "@/lib/logger";
import { encrypt } from "@/lib/crypto";
import { authMiddleware, type AuthUser } from "@/middleware/auth.middleware";
import { OauthStateRepository } from "@/repositories/oauth-state-repository";
import { UserRepository } from "@/repositories/user-repository";
import { UserSessionRepository } from "@/repositories/user-session-repository";
import {
  getGithubRoute,
  postTokenRoute,
  getMeRoute,
  postLogoutRoute,
} from "./routes";

export const authRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();
const loggerName = "auth.routes.ts";

/**
 * GET auth/github — returns the install + authorize URL
 * @returns The install + authorize URL and the nonce token
 */
authRoutes.openapi(getGithubRoute, async (c) => {
  // create a nonce token for CSRF protection
  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
  const oauthStateRepository = new OauthStateRepository(c.env.DB);

  logger.info("Starting GitHub OAuth flow", {
    loggerName,
    fields: {
      expiresAt,
      requestId: c.req.header("cf-ray") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    },
  });

  await oauthStateRepository.create(state, expiresAt);

  const github = new GitHubAppService(c.env, logger);
  const url = github.getAuthUrl(state);

  return c.json({ url, state }, 200);
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
  const oauthStateRepository = new OauthStateRepository(c.env.DB);
  const userRepository = new UserRepository(c.env.DB);
  const userSessionRepository = new UserSessionRepository(c.env.DB);

  logger.info("Received GitHub OAuth callback", {
    loggerName,
    fields: {
      hasCode: Boolean(code),
      requestId: c.req.header("cf-ray") ?? null,
      statePrefix: state?.slice(0, 8) ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    },
  });

  if (!code || !state) {
    logger.error("GitHub OAuth callback missing code or state", {
      loggerName,
      fields: {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        requestId: c.req.header("cf-ray") ?? null,
      },
    });
    return c.json({ error: "Missing code or state" }, 400) as any;
  }

  // Validate and consume state
  if (!(await oauthStateRepository.consumeValid(state))) {
    logger.error("GitHub OAuth callback rejected: invalid or expired state", {
      loggerName,
      fields: {
        requestId: c.req.header("cf-ray") ?? null,
        statePrefix: state.slice(0, 8),
      },
    });
    return c.json({ error: "Invalid or expired state" }, 400);
  }

  // Exchange code for tokens
  const github = new GitHubAppService(c.env, logger);
  let result;
  try {
    result = await github.exchangeOAuthCode(code);
  } catch (error) {
    logger.error("GitHub OAuth code exchange failed", {
      loggerName,
      error,
      fields: {
        requestId: c.req.header("cf-ray") ?? null,
        statePrefix: state.slice(0, 8),
      },
    });
    return c.json({ error: "Failed to exchange OAuth code" }, 400);
  }

  // Check allowlist
  const allowedRaw = c.env.ALLOWED_GITHUB_LOGINS ?? "";
  const allowedLogins = allowedRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (
    allowedLogins.length === 0 ||
    !allowedLogins.includes(result.user.login.toLowerCase())
  ) {
    logger.error("GitHub OAuth callback rejected: user not allowlisted", {
      loggerName,
      fields: {
        githubLogin: result.user.login,
        requestId: c.req.header("cf-ray") ?? null,
      },
    });
    return c.json({ error: "User not allowed" }, 403);
  }

  // Encrypt tokens before storing
  const encryptedAccess = await encrypt(
    result.accessToken,
    c.env.TOKEN_ENCRYPTION_KEY,
  );
  const encryptedRefresh = result.refreshToken
    ? await encrypt(result.refreshToken, c.env.TOKEN_ENCRYPTION_KEY)
    : null;

  // Upsert user (no tokens on the user row)
  // Only used for new users; existing users keep their original id
  const userId = crypto.randomUUID();
  await userRepository.upsertGitHubUser({
    id: userId,
    githubId: result.user.id,
    githubLogin: result.user.login,
    githubName: result.user.name,
    githubAvatarUrl: result.user.avatarUrl,
  });

  // Get the actual user ID (may be existing)
  const user = await userRepository.getByGitHubId(result.user.id);

  if (!user) {
    return c.json({ error: "Failed to create user" }, 500);
  }

  // Create auth session with access token (30 days)
  const sessionToken = crypto.randomUUID();
  const sessionExpires = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await userSessionRepository.createAuthSession(
    sessionToken,
    user.id,
    encryptedAccess,
    result.expiresAt ?? null,
    sessionExpires,
  );

  // Upsert refresh token (one per user)
  if (encryptedRefresh) {
    await userSessionRepository.upsertRefreshToken(
      user.id,
      encryptedRefresh,
      result.refreshTokenExpiresAt ?? null,
    );
  }

  // Check if user has any GitHub App installations
  const userOctokit = new Octokit({ auth: result.accessToken });
  let hasInstallations = false;
  try {
    const { data } =
      await userOctokit.request("GET /user/installations", {
        per_page: 1,
      });
    hasInstallations = data.total_count > 0;
  } catch {
    // If the check fails, assume no installations to prompt setup
    console.error("Failed to check for GitHub app installations");
  }

  const installUrl = github.getInstallUrl();

  logger.info("GitHub OAuth login succeeded", {
    loggerName,
    fields: {
      githubLogin: user.githubLogin,
      hasInstallations,
      requestId: c.req.header("cf-ray") ?? null,
    },
  });

  return c.json(
    {
      token: sessionToken,
      user: {
        id: user.id,
        login: user.githubLogin,
        name: user.githubName,
        avatarUrl: user.githubAvatarUrl,
      },
      hasInstallations,
      installUrl,
    },
    200,
  );
});

// GET /auth/me — returns current user info
authRoutes.use("/me", authMiddleware);
authRoutes.openapi(getMeRoute, async (c) => {
  const user = c.get("user");
  return c.json(
    {
      id: user.id,
      login: user.githubLogin,
      name: user.githubName,
      avatarUrl: user.githubAvatarUrl,
    },
    200,
  );
});

// POST /auth/logout — deletes auth session
authRoutes.use("/logout", authMiddleware);
authRoutes.openapi(postLogoutRoute, async (c) => {
  const authHeader = c.req.header("Authorization")!;
  const token = authHeader.slice(7);
  const userSessionRepository = new UserSessionRepository(c.env.DB);

  await userSessionRepository.deleteByToken(token);

  return c.json({ ok: true as const }, 200);
});
