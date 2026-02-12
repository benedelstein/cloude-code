import { createMiddleware } from "hono/factory";
import type { Env } from "@/types";
import { decrypt, encrypt } from "@/lib/crypto";
import { GitHubAppService } from "@/lib/github";

export interface AuthUser {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
  githubAccessToken: string; // decrypted
}

type AuthEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);

  // Access token lives on auth_sessions, not users
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.github_id, u.github_login, u.github_name, u.github_avatar_url,
            s.github_access_token, s.token_expires_at,
            s.expires_at as session_expires_at, s.token as session_token
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
  )
    .bind(token)
    .first<{
      id: string;
      github_id: number;
      github_login: string;
      github_name: string | null;
      github_avatar_url: string | null;
      github_access_token: string;
      token_expires_at: string | null;
      session_expires_at: string;
      session_token: string;
    }>();

  if (!row) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let accessToken = await decrypt(
    row.github_access_token,
    c.env.TOKEN_ENCRYPTION_KEY,
  );

  // Refresh if GitHub token is expired
  if (row.token_expires_at && new Date(row.token_expires_at) < new Date()) {
    // Read refresh token from separate table
    const refreshRow = await c.env.DB.prepare(
      `SELECT encrypted_token FROM user_refresh_tokens WHERE user_id = ?`,
    )
      .bind(row.id)
      .first<{ encrypted_token: string }>();

    if (!refreshRow) {
      return c.json({ error: "Token expired and no refresh token" }, 401);
    }

    try {
      const github = new GitHubAppService(c.env);
      const decryptedRefresh = await decrypt(
        refreshRow.encrypted_token,
        c.env.TOKEN_ENCRYPTION_KEY,
      );
      const refreshed = await github.refreshUserToken(decryptedRefresh);

      const encryptedAccess = await encrypt(
        refreshed.accessToken,
        c.env.TOKEN_ENCRYPTION_KEY,
      );
      const encryptedRefresh = await encrypt(
        refreshed.refreshToken,
        c.env.TOKEN_ENCRYPTION_KEY,
      );

      // Update access token on this session
      await c.env.DB.prepare(
        `UPDATE auth_sessions SET github_access_token = ?, token_expires_at = ?
         WHERE token = ?`,
      )
        .bind(encryptedAccess, refreshed.expiresAt, row.session_token)
        .run();

      // Update refresh token for the user
      await c.env.DB.prepare(
        `UPDATE user_refresh_tokens SET encrypted_token = ?, expires_at = ?,
         updated_at = datetime('now') WHERE user_id = ?`,
      )
        .bind(
          encryptedRefresh,
          refreshed.refreshTokenExpiresAt ?? null,
          row.id,
        )
        .run();

      accessToken = refreshed.accessToken;
    } catch {
      return c.json({ error: "Token refresh failed" }, 401);
    }
  }

  c.set("user", {
    id: row.id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    githubName: row.github_name,
    githubAvatarUrl: row.github_avatar_url,
    githubAccessToken: accessToken,
  });

  await next();
});
