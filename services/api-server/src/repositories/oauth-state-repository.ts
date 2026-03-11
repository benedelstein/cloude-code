export interface OauthStateRecord {
  state: string;
  codeVerifier: string | null;
}

interface OauthStateRow {
  state: string;
  code_verifier: string | null;
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
  ): Promise<void> {
    await this.database.prepare(
      `INSERT INTO oauth_states (state, expires_at, code_verifier) VALUES (?, ?, ?)`,
    )
      .bind(state, expiresAt, codeVerifier)
      .run();
  }

  async consumeValid(state: string): Promise<OauthStateRecord | null> {
    const row = await this.database.prepare(
      `DELETE FROM oauth_states
       WHERE state = ? AND datetime(expires_at) > datetime('now')
       RETURNING state, code_verifier`,
    )
      .bind(state)
      .first<OauthStateRow>();

    if (!row) {
      return null;
    }

    return {
      state: row.state,
      codeVerifier: row.code_verifier ?? null,
    };
  }
}
