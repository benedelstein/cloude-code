import type { IntegrationProvider } from "@repo/shared";

export interface IntegrationAccountLinkRecord {
  provider: IntegrationProvider;
  externalUserId: string;
  userId: string;
  externalUsername: string | null;
  expiresAt: string;
}

export interface IntegrationAccountLinkSummary {
  provider: IntegrationProvider;
  externalUserId: string;
  externalUsername: string | null;
  expiresAt: string;
  lastUsedAt: string | null;
}

interface IntegrationAccountLinkRow {
  provider: IntegrationProvider;
  external_user_id: string;
  user_id: string;
  external_username: string | null;
  expires_at: string;
}

interface IntegrationAccountLinkSummaryRow {
  provider: IntegrationProvider;
  external_user_id: string;
  external_username: string | null;
  expires_at: string;
  last_used_at: string | null;
}

export class IntegrationAccountLinkRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async getActive(params: {
    provider: IntegrationProvider;
    externalUserId: string;
  }): Promise<IntegrationAccountLinkRecord | null> {
    const row = await this.database.prepare(
      `SELECT provider, external_user_id, user_id, external_username, expires_at
       FROM integration_account_links
       WHERE provider = ?
         AND external_user_id = ?
         AND revoked_at IS NULL
         AND datetime(expires_at) > datetime('now')`,
    )
      .bind(params.provider, params.externalUserId)
      .first<IntegrationAccountLinkRow>();

    return row ? rowToRecord(row) : null;
  }

  async upsert(params: {
    provider: IntegrationProvider;
    externalUserId: string;
    userId: string;
    externalUsername: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO integration_account_links (
         provider,
         external_user_id,
         user_id,
         external_username,
         expires_at,
         revoked_at
       )
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(provider, external_user_id) DO UPDATE SET
         user_id = excluded.user_id,
         external_username = excluded.external_username,
         expires_at = excluded.expires_at,
         revoked_at = NULL,
         updated_at = datetime('now')`,
    )
      .bind(
        params.provider,
        params.externalUserId,
        params.userId,
        params.externalUsername,
        params.expiresAt,
      )
      .run();
  }

  async listActiveByUserId(userId: string): Promise<IntegrationAccountLinkSummary[]> {
    const result = await this.database.prepare(
      `SELECT provider, external_user_id, external_username, expires_at, last_used_at
       FROM integration_account_links
       WHERE user_id = ?
         AND revoked_at IS NULL
         AND datetime(expires_at) > datetime('now')
       ORDER BY provider`,
    )
      .bind(userId)
      .all<IntegrationAccountLinkSummaryRow>();

    return result.results.map((row) => ({
      provider: row.provider,
      externalUserId: row.external_user_id,
      externalUsername: row.external_username,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  async revokeByUserAndProvider(params: {
    userId: string;
    provider: IntegrationProvider;
  }): Promise<void> {
    await this.database.prepare(
      `UPDATE integration_account_links
       SET revoked_at = datetime('now'),
           updated_at = datetime('now')
       WHERE user_id = ? AND provider = ? AND revoked_at IS NULL`,
    )
      .bind(params.userId, params.provider)
      .run();
  }

  async touchLastUsed(params: {
    provider: IntegrationProvider;
    externalUserId: string;
    externalUsername: string | null;
  }): Promise<void> {
    await this.database.prepare(
      `UPDATE integration_account_links
       SET last_used_at = datetime('now'),
           external_username = COALESCE(?, external_username),
           updated_at = datetime('now')
       WHERE provider = ? AND external_user_id = ?`,
    )
      .bind(params.externalUsername, params.provider, params.externalUserId)
      .run();
  }
}

function rowToRecord(row: IntegrationAccountLinkRow): IntegrationAccountLinkRecord {
  return {
    provider: row.provider,
    externalUserId: row.external_user_id,
    userId: row.user_id,
    externalUsername: row.external_username,
    expiresAt: row.expires_at,
  };
}
