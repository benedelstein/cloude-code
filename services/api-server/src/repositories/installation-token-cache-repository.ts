interface TokenCacheRow {
  token: string;
  expires_at: string;
}

export class InstallationTokenCacheRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async get(
    installationId: number,
    cacheKey: string,
  ): Promise<{ token: string; expiresAt: string } | null> {
    const row = await this.database.prepare(
      `SELECT token, expires_at FROM installation_token_cache
       WHERE installation_id = ? AND repo_id = ?
       AND datetime(expires_at) > datetime('now', '+5 minutes')`,
    )
      .bind(installationId, cacheKey)
      .first<TokenCacheRow>();

    if (!row) return null;

    return {
      token: row.token,
      expiresAt: row.expires_at,
    };
  }

  async set(
    installationId: number,
    cacheKey: string,
    encryptedToken: string,
    expiresAt: string,
  ): Promise<void> {
    await this.database.prepare(
      `INSERT OR REPLACE INTO installation_token_cache (installation_id, repo_id, token, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(installationId, cacheKey, encryptedToken, expiresAt)
      .run();
  }
}
