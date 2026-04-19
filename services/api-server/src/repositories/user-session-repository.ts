export interface AuthSessionUserRecord {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
  githubAccessToken: string;
  tokenExpiresAt: string | null;
  sessionExpiresAt: string;
}

interface AuthSessionUserRow {
  id: string;
  github_id: number;
  github_login: string;
  github_name: string | null;
  github_avatar_url: string | null;
  github_access_token: string;
  token_expires_at: string | null;
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

export class UserSessionRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async getActiveAuthSessionByToken(
    token: string,
  ): Promise<AuthSessionUserRecord | null> {
    const row = await this.database.prepare(
      `SELECT u.id, u.github_id, u.github_login, u.github_name, u.github_avatar_url,
              credentials.encrypted_access_token AS github_access_token,
              credentials.access_token_expires_at AS token_expires_at,
              s.expires_at AS session_expires_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN user_github_credentials credentials ON credentials.user_id = u.id
       WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
    )
      .bind(token)
      .first<AuthSessionUserRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      githubId: row.github_id,
      githubLogin: row.github_login,
      githubName: row.github_name,
      githubAvatarUrl: row.github_avatar_url,
      githubAccessToken: row.github_access_token,
      tokenExpiresAt: row.token_expires_at,
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
    await this.database.prepare(
      `INSERT INTO auth_sessions (token, user_id, expires_at)
       VALUES (?, ?, ?)`,
    )
      .bind(sessionToken, userId, expiresAt)
      .run();
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
         encrypted_refresh_token = excluded.encrypted_refresh_token,
         refresh_token_expires_at = excluded.refresh_token_expires_at,
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

  async deleteByToken(sessionToken: string): Promise<void> {
    await this.database.prepare(`DELETE FROM auth_sessions WHERE token = ?`)
      .bind(sessionToken)
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
        `DELETE FROM user_github_credentials WHERE user_id IN (SELECT id FROM users WHERE github_id = ?)`,
      ).bind(githubId),
    ]);
  }
}
