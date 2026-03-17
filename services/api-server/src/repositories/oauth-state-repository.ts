export interface OauthStateRecord {
  state: string;
  codeVerifier: string | null;
  redirectUri: string | null;
}

interface OauthStateRow {
  state: string;
  code_verifier: string | null;
  redirect_uri: string | null;
}

/**
 * Stores temporary nonce state for auth flow
 */
export class OauthStateRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(
    state: string,
    expiresAt: string,
    codeVerifier: string | null = null,
    redirectUri: string | null = null,
  ): Promise<void> {
    await this.database.prepare(
      `INSERT INTO oauth_states (state, expires_at, code_verifier, redirect_uri) VALUES (?, ?, ?, ?)`,
    )
      .bind(state, expiresAt, codeVerifier, redirectUri)
      .run();
  }

  async consumeValid(state: string): Promise<OauthStateRecord | null> {
    const row = await this.database.prepare(
      `DELETE FROM oauth_states
       WHERE state = ? AND datetime(expires_at) > datetime('now')
       RETURNING state, code_verifier, redirect_uri`,
    )
      .bind(state)
      .first<OauthStateRow>();

    if (!row) {
      return null;
    }

    return {
      state: row.state,
      codeVerifier: row.code_verifier ?? null,
      redirectUri: row.redirect_uri ?? null,
    };
  }
}
