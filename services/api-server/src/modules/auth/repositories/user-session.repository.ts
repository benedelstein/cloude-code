import { sha256 } from "@/shared/utils/crypto";

export interface AuthSessionIdentityRecord {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
  sessionExpiresAt: string;
}

interface AuthSessionIdentityRow {
  id: string;
  github_id: number;
  github_login: string;
  github_name: string | null;
  github_avatar_url: string | null;
  session_expires_at: string;
}

export interface UserGitHubCredentialsRecord {
  encryptedAccessToken: string;
  accessTokenExpiresAt: string | null;
  encryptedRefreshToken: string | null;
  refreshTokenExpiresAt: string | null;
}

interface UserGitHubCredentialsRow {
  encrypted_access_token: string;
  access_token_expires_at: string | null;
  encrypted_refresh_token: string | null;
  refresh_token_expires_at: string | null;
}

export interface RefreshSessionRecord {
  id: string;
  userId: string;
  refreshExpiresAt: string;
  /** ISO-8601 UTC (normalized from sqlite datetime in the query). */
  previousRotatedAt: string | null;
  /** Which stored hash the presented token matched. */
  matched: "current" | "previous";
}

interface RefreshSessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  previous_rotated_at: string | null;
  refresh_expires_at: string;
}

export class UserSessionRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async getActiveAuthSessionByToken(
    token: string,
  ): Promise<AuthSessionIdentityRecord | null> {
    const tokenHash = await sha256(token);
    const row = await this.database.prepare(
      `SELECT u.id, u.github_id, u.github_login, u.github_name, u.github_avatar_url,
              s.expires_at AS session_expires_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')`,
    )
      .bind(tokenHash)
      .first<AuthSessionIdentityRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      githubId: row.github_id,
      githubLogin: row.github_login,
      githubName: row.github_name,
      githubAvatarUrl: row.github_avatar_url,
      sessionExpiresAt: row.session_expires_at,
    };
  }

  async getGitHubCredentialsByUserId(
    userId: string,
  ): Promise<UserGitHubCredentialsRecord | null> {
    const row = await this.database.prepare(
      `SELECT encrypted_access_token, access_token_expires_at,
              encrypted_refresh_token, refresh_token_expires_at
       FROM user_github_credentials
       WHERE user_id = ?`,
    )
      .bind(userId)
      .first<UserGitHubCredentialsRow>();

    if (!row) {
      return null;
    }

    return {
      encryptedAccessToken: row.encrypted_access_token,
      accessTokenExpiresAt: row.access_token_expires_at,
      encryptedRefreshToken: row.encrypted_refresh_token,
      refreshTokenExpiresAt: row.refresh_token_expires_at,
    };
  }

  async createAuthSession(
    sessionToken: string,
    userId: string,
    expiresAt: string,
  ): Promise<void> {
    const sessionTokenHash = await sha256(sessionToken);
    await this.database.prepare(
      `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
       VALUES (?, ?, ?)`,
    )
      .bind(sessionTokenHash, userId, expiresAt)
      .run();
  }

  async createAuthSessionWithGitHubCredentials(params: {
    sessionToken: string;
    userId: string;
    sessionExpiresAt: string;
    encryptedAccessToken: string;
    accessTokenExpiresAt: string | null;
    encryptedRefreshToken: string | null;
    refreshTokenExpiresAt: string | null;
  }): Promise<void> {
    const sessionTokenHash = await sha256(params.sessionToken);
    await this.database.batch([
      this.database.prepare(
        `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
         VALUES (?, ?, ?)`,
      ).bind(
        sessionTokenHash,
        params.userId,
        params.sessionExpiresAt,
      ),
      this.database.prepare(
        `INSERT INTO user_github_credentials (
           user_id,
           encrypted_access_token,
           access_token_expires_at,
           encrypted_refresh_token,
           refresh_token_expires_at
         )
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           encrypted_access_token = excluded.encrypted_access_token,
           access_token_expires_at = excluded.access_token_expires_at,
           encrypted_refresh_token = COALESCE(
             excluded.encrypted_refresh_token,
             user_github_credentials.encrypted_refresh_token
           ),
           refresh_token_expires_at = COALESCE(
             excluded.refresh_token_expires_at,
             user_github_credentials.refresh_token_expires_at
           ),
           updated_at = datetime('now')`,
      ).bind(
        params.userId,
        params.encryptedAccessToken,
        params.accessTokenExpiresAt,
        params.encryptedRefreshToken,
        params.refreshTokenExpiresAt,
      ),
    ]);
  }

  async upsertGitHubCredentials(params: {
    userId: string;
    encryptedAccessToken: string;
    accessTokenExpiresAt: string | null;
    encryptedRefreshToken: string | null;
    refreshTokenExpiresAt: string | null;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO user_github_credentials (
         user_id,
         encrypted_access_token,
         access_token_expires_at,
         encrypted_refresh_token,
         refresh_token_expires_at
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_access_token = excluded.encrypted_access_token,
         access_token_expires_at = excluded.access_token_expires_at,
         encrypted_refresh_token = COALESCE(
           excluded.encrypted_refresh_token,
           user_github_credentials.encrypted_refresh_token
         ),
         refresh_token_expires_at = COALESCE(
           excluded.refresh_token_expires_at,
           user_github_credentials.refresh_token_expires_at
         ),
         updated_at = datetime('now')`,
    )
      .bind(
        params.userId,
        params.encryptedAccessToken,
        params.accessTokenExpiresAt,
        params.encryptedRefreshToken,
        params.refreshTokenExpiresAt,
      )
      .run();
  }

  async updateGitHubCredentials(params: {
    userId: string;
    encryptedAccessToken: string;
    accessTokenExpiresAt: string | null;
    encryptedRefreshToken: string | null;
    refreshTokenExpiresAt: string | null;
  }): Promise<void> {
    await this.database.prepare(
      `UPDATE user_github_credentials
       SET encrypted_access_token = ?,
           access_token_expires_at = ?,
           encrypted_refresh_token = ?,
           refresh_token_expires_at = ?,
           updated_at = datetime('now')
       WHERE user_id = ?`,
    )
      .bind(
        params.encryptedAccessToken,
        params.accessTokenExpiresAt,
        params.encryptedRefreshToken,
        params.refreshTokenExpiresAt,
        params.userId,
      )
      .run();
  }

  /**
   * Create a native refresh-session family. Native access tokens are stateless
   * JWTs, so only the rotating refresh token family is stored.
   */
  async createRefreshSession(params: {
    refreshSessionId: string;
    userId: string;
    refreshTokenHash: string;
    refreshExpiresAt: string;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO auth_refresh_sessions (id, user_id, refresh_token_hash, refresh_expires_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      params.refreshSessionId,
      params.userId,
      params.refreshTokenHash,
      params.refreshExpiresAt,
    ).run();
  }

  /**
   * Look up a refresh session by token hash, matching the current hash or the
   * rotated-out previous hash (grace window / reuse detection). Reports which
   * one matched so the service can apply grace-window rules.
   */
  async getRefreshSessionByTokenHash(
    tokenHash: string,
  ): Promise<RefreshSessionRecord | null> {
    const row = await this.database.prepare(
      `SELECT id, user_id, refresh_token_hash, refresh_expires_at,
              strftime('%Y-%m-%dT%H:%M:%SZ', previous_rotated_at) AS previous_rotated_at
       FROM auth_refresh_sessions
       WHERE refresh_token_hash = ? OR previous_refresh_token_hash = ?`,
    )
      .bind(tokenHash, tokenHash)
      .first<RefreshSessionRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      refreshExpiresAt: row.refresh_expires_at,
      previousRotatedAt: row.previous_rotated_at,
      matched: row.refresh_token_hash === tokenHash ? "current" : "previous",
    };
  }

  /**
   * Rotate a refresh-session family: swap in the new refresh token hash
   * (keeping the old one for grace-window retries) and extend the sliding
   * refresh expiry. Native access tokens are stateless JWTs and are minted
   * after this write succeeds.
   */
  async rotateRefreshSession(params: {
    refreshSessionId: string;
    userId: string;
    newRefreshTokenHash: string;
    previousRefreshTokenHash: string;
    refreshExpiresAt: string;
  }): Promise<void> {
    await this.database.prepare(
      `UPDATE auth_refresh_sessions
       SET refresh_token_hash = ?,
           previous_refresh_token_hash = ?,
           previous_rotated_at = datetime('now'),
           refresh_expires_at = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).bind(
      params.newRefreshTokenHash,
      params.previousRefreshTokenHash,
      params.refreshExpiresAt,
      params.refreshSessionId,
    ).run();
  }

  /** Revoke a whole session family plus any legacy linked access rows. */
  async revokeRefreshSession(refreshSessionId: string): Promise<void> {
    await this.database.batch([
      this.database.prepare(
        `DELETE FROM auth_sessions WHERE refresh_session_id = ?`,
      ).bind(refreshSessionId),
      this.database.prepare(
        `DELETE FROM auth_refresh_sessions WHERE id = ?`,
      ).bind(refreshSessionId),
    ]);
  }

  /** Family id for an access token, or null for legacy web sessions. */
  async getRefreshSessionIdByAccessToken(
    accessToken: string,
  ): Promise<string | null> {
    const accessTokenHash = await sha256(accessToken);
    const row = await this.database.prepare(
      `SELECT refresh_session_id FROM auth_sessions WHERE token_hash = ?`,
    )
      .bind(accessTokenHash)
      .first<{ refresh_session_id: string | null }>();

    return row?.refresh_session_id ?? null;
  }

  async deleteByToken(sessionToken: string): Promise<void> {
    const sessionTokenHash = await sha256(sessionToken);
    await this.database.prepare(
      `DELETE FROM auth_sessions
       WHERE token_hash = ? OR (token_hash IS NULL AND token = ?)`,
    )
      .bind(sessionTokenHash, sessionToken)
      .run();
  }

  /**
   * Revoke all sessions for a user and delete their GitHub credentials.
   * Use for "sign out everywhere" or account deletion flows.
   * For single-session logout, use deleteByToken instead.
   */
  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.database.batch([
      this.database.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).bind(userId),
      this.database.prepare(`DELETE FROM auth_refresh_sessions WHERE user_id = ?`).bind(userId),
      this.database.prepare(`DELETE FROM user_github_credentials WHERE user_id = ?`).bind(userId),
    ]);
  }

  /**
   * Revoke all sessions for a user identified by their GitHub numeric ID.
   * Used when GitHub sends a github_app_authorization.revoked webhook,
   * where only the GitHub user ID is available in the payload.
   */
  async revokeAllSessionsByGithubId(githubId: number): Promise<void> {
    await this.database.batch([
      this.database.prepare(
        `DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE github_id = ?)`,
      ).bind(githubId),
      this.database.prepare(
        `DELETE FROM auth_refresh_sessions WHERE user_id IN (SELECT id FROM users WHERE github_id = ?)`,
      ).bind(githubId),
      this.database.prepare(
        `DELETE FROM user_github_credentials WHERE user_id IN (SELECT id FROM users WHERE github_id = ?)`,
      ).bind(githubId),
    ]);
  }

  async deleteGitHubCredentialsByGithubId(githubId: number): Promise<void> {
    await this.database.prepare(
      `DELETE FROM user_github_credentials
       WHERE user_id IN (SELECT id FROM users WHERE github_id = ?)`,
    )
      .bind(githubId)
      .run();
  }
}
