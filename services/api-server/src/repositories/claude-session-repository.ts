export interface ClaudeOauthState {
  state: string;
  codeVerifier: string;
}

export interface ClaudeSessionRecord {
  userId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  expiresAtMs: number;
  scopesJson: string;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  requiresReauth: boolean;
}

interface ClaudeOauthStateRow {
  state: string;
  code_verifier: string;
}

interface ClaudeSessionRow {
  user_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  expires_at_ms: number | string;
  scopes_json: string;
  subscription_type: string | null;
  rate_limit_tier: string | null;
  requires_reauth: number;
}

interface UpsertClaudeSessionInput {
  userId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  expiresAtMs: number;
  scopesJson: string;
  subscriptionType: string | null;
  rateLimitTier: string | null;
}

export class ClaudeSessionRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async createOauthState(
    state: string,
    expiresAt: string,
    codeVerifier: string,
  ): Promise<void> {
    await this.database.prepare(
      `INSERT INTO oauth_states (state, expires_at, code_verifier) VALUES (?, ?, ?)`,
    )
      .bind(state, expiresAt, codeVerifier)
      .run();
  }

  async consumeOauthState(state: string): Promise<ClaudeOauthState | null> {
    const row = await this.database.prepare(
      `DELETE FROM oauth_states
       WHERE state = ? AND datetime(expires_at) > datetime('now')
       RETURNING state, code_verifier`,
    )
      .bind(state)
      .first<ClaudeOauthStateRow>();

    if (!row?.code_verifier) {
      return null;
    }

    return {
      state: row.state,
      codeVerifier: row.code_verifier,
    };
  }

  async upsertClaudeSession(input: UpsertClaudeSessionInput): Promise<void> {
    await this.database.prepare(
      `INSERT INTO claude_tokens (
         user_id,
         encrypted_access_token,
         encrypted_refresh_token,
         expires_at_ms,
         scopes_json,
         subscription_type,
         rate_limit_tier
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_access_token = excluded.encrypted_access_token,
         encrypted_refresh_token = excluded.encrypted_refresh_token,
         expires_at_ms = excluded.expires_at_ms,
         scopes_json = excluded.scopes_json,
         subscription_type = excluded.subscription_type,
         rate_limit_tier = excluded.rate_limit_tier,
         requires_reauth = 0,
         updated_at = datetime('now')`,
    )
      .bind(
        input.userId,
        input.encryptedAccessToken,
        input.encryptedRefreshToken,
        input.expiresAtMs,
        input.scopesJson,
        input.subscriptionType,
        input.rateLimitTier,
      )
      .run();
  }

  async getSessionByUserId(userId: string): Promise<ClaudeSessionRecord | null> {
    const row = await this.database.prepare(
      `SELECT user_id,
              encrypted_access_token,
              encrypted_refresh_token,
              expires_at_ms,
              scopes_json,
              subscription_type,
              rate_limit_tier,
              requires_reauth
       FROM claude_tokens
       WHERE user_id = ?`,
    )
      .bind(userId)
      .first<ClaudeSessionRow>();

    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      encryptedAccessToken: row.encrypted_access_token,
      encryptedRefreshToken: row.encrypted_refresh_token,
      expiresAtMs: Number(row.expires_at_ms),
      scopesJson: row.scopes_json,
      subscriptionType: row.subscription_type ?? null,
      rateLimitTier: row.rate_limit_tier ?? null,
      requiresReauth: row.requires_reauth === 1,
    };
  }

  async markRequiresReauth(userId: string): Promise<void> {
    await this.database.prepare(
      `UPDATE claude_tokens
       SET requires_reauth = 1,
           updated_at = datetime('now')
       WHERE user_id = ?`,
    )
      .bind(userId)
      .run();
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.database.prepare(`DELETE FROM claude_tokens WHERE user_id = ?`)
      .bind(userId)
      .run();
  }
}
