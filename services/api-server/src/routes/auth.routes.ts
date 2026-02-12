import { Hono } from "hono";
import type { Env } from "@/types";
import { GitHubAppService } from "@/lib/github";
import { encrypt } from "@/lib/crypto";
import { authMiddleware } from "@/middleware/auth.middleware";

export const authRoutes = new Hono<{ Bindings: Env }>();

// GET /auth/github — returns the install + authorize URL
authRoutes.get("/github", async (c) => {
  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  await c.env.DB.prepare(
    `INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)`,
  )
    .bind(state, expiresAt)
    .run();

  const github = new GitHubAppService(c.env);
  const url = github.getAuthUrl(state);

  return c.json({ url, state });
});

// POST /auth/token — exchange code for session token
authRoutes.post("/token", async (c) => {
  const { code, state } = await c.req.json<{ code: string; state: string }>();

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  // Validate and consume state
  const stateRow = await c.env.DB.prepare(
    `DELETE FROM oauth_states WHERE state = ? AND datetime(expires_at) > datetime('now') RETURNING state`,
  )
    .bind(state)
    .first();

  if (!stateRow) {
    return c.json({ error: "Invalid or expired state" }, 400);
  }

  // Exchange code for tokens
  const github = new GitHubAppService(c.env);
  let result;
  try {
    result = await github.exchangeOAuthCode(code);
  } catch {
    return c.json({ error: "Failed to exchange OAuth code" }, 400);
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
  const userId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO users (id, github_id, github_login, github_name, github_avatar_url)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (github_id) DO UPDATE SET
       github_login = excluded.github_login,
       github_name = excluded.github_name,
       github_avatar_url = excluded.github_avatar_url,
       updated_at = datetime('now')`,
  )
    .bind(
      userId,
      result.user.id,
      result.user.login,
      result.user.name,
      result.user.avatarUrl,
    )
    .run();

  // Get the actual user ID (may be existing)
  const user = await c.env.DB.prepare(
    `SELECT id, github_login, github_name, github_avatar_url FROM users WHERE github_id = ?`,
  )
    .bind(result.user.id)
    .first<{
      id: string;
      github_login: string;
      github_name: string | null;
      github_avatar_url: string | null;
    }>();

  if (!user) {
    return c.json({ error: "Failed to create user" }, 500);
  }

  // Create auth session with access token (30 days)
  const sessionToken = crypto.randomUUID();
  const sessionExpires = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO auth_sessions (token, user_id, github_access_token, token_expires_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionToken,
      user.id,
      encryptedAccess,
      result.expiresAt ?? null,
      sessionExpires,
    )
    .run();

  // Upsert refresh token (one per user)
  if (encryptedRefresh) {
    await c.env.DB.prepare(
      `INSERT INTO user_refresh_tokens (user_id, encrypted_token, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_token = excluded.encrypted_token,
         expires_at = excluded.expires_at,
         updated_at = datetime('now')`,
    )
      .bind(user.id, encryptedRefresh, result.refreshTokenExpiresAt ?? null)
      .run();
  }

  return c.json({
    token: sessionToken,
    user: {
      id: user.id,
      login: user.github_login,
      name: user.github_name,
      avatarUrl: user.github_avatar_url,
    },
  });
});

// GET /auth/me — returns current user info
authRoutes.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  return c.json({
    id: user.id,
    login: user.githubLogin,
    name: user.githubName,
    avatarUrl: user.githubAvatarUrl,
  });
});

// POST /auth/logout — deletes auth session
authRoutes.post("/logout", authMiddleware, async (c) => {
  const authHeader = c.req.header("Authorization")!;
  const token = authHeader.slice(7);

  await c.env.DB.prepare(`DELETE FROM auth_sessions WHERE token = ?`)
    .bind(token)
    .run();

  return c.json({ ok: true });
});
