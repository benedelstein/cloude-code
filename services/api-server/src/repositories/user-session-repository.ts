export interface AuthSessionUserRecord {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
  githubAccessToken: string;
  tokenExpiresAt: string | null;
  sessionExpiresAt: string;
  sessionToken: string;
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
  session_token: string;
}

interface RefreshTokenRow {
  encrypted_token: string;
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
              s.github_access_token, s.token_expires_at,
              s.expires_at as session_expires_at, s.token as session_token
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
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
      sessionToken: row.session_token,
    };
  }

  async getRefreshTokenByUserId(userId: string): Promise<string | null> {
    const row = await this.database.prepare(
      `SELECT encrypted_token FROM user_refresh_tokens WHERE user_id = ?`,
    )
      .bind(userId)
      .first<RefreshTokenRow>();

    return row?.encrypted_token ?? null;
  }

  async createAuthSession(
    sessionToken: string,
    userId: string,
    githubAccessToken: string,
    tokenExpiresAt: string | null,
    expiresAt: string,
  ): Promise<void> {
    await this.database.prepare(
      `INSERT INTO auth_sessions (token, user_id, github_access_token, token_expires_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(sessionToken, userId, githubAccessToken, tokenExpiresAt, expiresAt)
      .run();
  }

  async upsertRefreshToken(
    userId: string,
    encryptedToken: string,
    expiresAt: string | null,
  ): Promise<void> {
    await this.database.prepare(
      `INSERT INTO user_refresh_tokens (user_id, encrypted_token, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_token = excluded.encrypted_token,
         expires_at = excluded.expires_at,
         updated_at = datetime('now')`,
    )
      .bind(userId, encryptedToken, expiresAt)
      .run();
  }

  async updateSessionAccessToken(
    sessionToken: string,
    githubAccessToken: string,
    tokenExpiresAt: string | null,
  ): Promise<void> {
    await this.database.prepare(
      `UPDATE auth_sessions SET github_access_token = ?, token_expires_at = ?
       WHERE token = ?`,
    )
      .bind(githubAccessToken, tokenExpiresAt, sessionToken)
      .run();
  }

  async updateRefreshToken(
    userId: string,
    encryptedToken: string,
    expiresAt: string | null,
  ): Promise<void> {
    await this.database.prepare(
      `UPDATE user_refresh_tokens SET encrypted_token = ?, expires_at = ?,
       updated_at = datetime('now') WHERE user_id = ?`,
    )
      .bind(encryptedToken, expiresAt, userId)
      .run();
  }

  async deleteByToken(sessionToken: string): Promise<void> {
    await this.database.prepare(`DELETE FROM auth_sessions WHERE token = ?`)
      .bind(sessionToken)
      .run();
  }
}
