export interface ExternalAuthStateRecord {
  state: string;
  codeVerifier: string | null;
  redirectOrigin: string | null;
  purpose: string | null;
  userId: string | null;
  signInAttemptId: string | null;
}

interface ExternalAuthStateRow {
  state: string;
  code_verifier: string | null;
  redirect_origin: string | null;
  purpose: string | null;
  user_id: string | null;
  sign_in_attempt_id: string | null;
}

/**
 * One-time temporary state for browser round trips to an external provider.
 *
 * Rows are distinguished by `purpose`: OAuth CSRF state for GitHub login,
 * GitHub reauthorization, and AI-provider authorization, plus GitHub App
 * installation callback state. Each row binds its own validated redirect
 * target, optional user, optional sign-in attempt, and expiration, and is
 * consumed exactly once by the callback that owns it.
 *
 * The physical table is still named `oauth_states`.
 */
export class ExternalAuthStateRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(input: {
    state: string;
    expiresAt: string;
    codeVerifier: string | null;
    redirectOrigin: string | null;
    purpose: string | null;
    userId: string | null;
    signInAttemptId: string | null;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO oauth_states (
         state, expires_at, code_verifier, redirect_origin, purpose, user_id, sign_in_attempt_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        input.state,
        input.expiresAt,
        input.codeVerifier,
        input.redirectOrigin,
        input.purpose,
        input.userId,
        input.signInAttemptId,
      )
      .run();
  }

  async consumeValid(state: string): Promise<ExternalAuthStateRecord | null> {
    const row = await this.database.prepare(
      `DELETE FROM oauth_states
       WHERE state = ? AND datetime(expires_at) > datetime('now')
       RETURNING state, code_verifier, redirect_origin, purpose, user_id, sign_in_attempt_id`,
    )
      .bind(state)
      .first<ExternalAuthStateRow>();

    return row ? toRecord(row) : null;
  }

  async peek(state: string): Promise<ExternalAuthStateRecord | null> {
    const row = await this.database.prepare(
      `SELECT state, code_verifier, redirect_origin, purpose, user_id, sign_in_attempt_id
       FROM oauth_states
       WHERE state = ? AND datetime(expires_at) > datetime('now')`,
    )
      .bind(state)
      .first<ExternalAuthStateRow>();

    return row ? toRecord(row) : null;
  }

  /** Bounds storage: expired rows are rejected on read and never resurface. */
  async deleteExpired(): Promise<void> {
    await this.database.prepare(
      `DELETE FROM oauth_states WHERE datetime(expires_at) <= datetime('now')`,
    )
      .run();
  }
}

function toRecord(row: ExternalAuthStateRow): ExternalAuthStateRecord {
  return {
    state: row.state,
    codeVerifier: row.code_verifier ?? null,
    redirectOrigin: row.redirect_origin ?? null,
    purpose: row.purpose ?? null,
    userId: row.user_id ?? null,
    signInAttemptId: row.sign_in_attempt_id ?? null,
  };
}
