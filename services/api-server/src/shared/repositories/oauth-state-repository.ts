export interface OauthStateRecord {
  state: string;
  codeVerifier: string | null;
  redirectOrigin: string | null;
  purpose: string | null;
  userId: string | null;
}

interface OauthStateRow {
  state: string;
  code_verifier: string | null;
  redirect_origin: string | null;
  purpose: string | null;
  user_id: string | null;
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
    redirectOrigin: string | null = null,
    purpose: string | null = null,
    userId: string | null = null,
  ): Promise<void> {
    await this.database.prepare(
      `INSERT INTO oauth_states (state, expires_at, code_verifier, redirect_origin, purpose, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(state, expiresAt, codeVerifier, redirectOrigin, purpose, userId)
      .run();
  }

  async consumeValid(state: string): Promise<OauthStateRecord | null> {
    const row = await this.database.prepare(
      `DELETE FROM oauth_states
       WHERE state = ? AND datetime(expires_at) > datetime('now')
       RETURNING state, code_verifier, redirect_origin, purpose, user_id`,
    )
      .bind(state)
      .first<OauthStateRow>();

    if (!row) {
      return null;
    }

    return {
      state: row.state,
      codeVerifier: row.code_verifier ?? null,
      redirectOrigin: row.redirect_origin ?? null,
      purpose: row.purpose ?? null,
      userId: row.user_id ?? null,
    };
  }

  async peek(state: string): Promise<OauthStateRecord | null> {
    const row = await this.database.prepare(
      `SELECT state, code_verifier, redirect_origin, purpose, user_id
       FROM oauth_states
       WHERE state = ? AND datetime(expires_at) > datetime('now')`,
    )
      .bind(state)
      .first<OauthStateRow>();

    if (!row) {
      return null;
    }

    return {
      state: row.state,
      codeVerifier: row.code_verifier ?? null,
      redirectOrigin: row.redirect_origin ?? null,
      purpose: row.purpose ?? null,
      userId: row.user_id ?? null,
    };
  }

  /**
   * Look up the redirect origin for a state without consuming the row.
   * Used by the bounce route to discover where to forward the OAuth code;
   * actual single-use consumption still happens in `consumeValid` during the
   * subsequent /auth/token exchange.
   */
  async peekRedirectOrigin(state: string): Promise<string | null> {
    return (await this.peek(state))?.redirectOrigin ?? null;
  }
}
