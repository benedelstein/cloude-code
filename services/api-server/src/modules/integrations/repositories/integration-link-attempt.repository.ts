import type { IntegrationProvider } from "@repo/shared";

export interface IntegrationLinkAttemptRecord {
  provider: IntegrationProvider;
  externalUserId: string;
  externalUsername: string | null;
  expiresAt: string;
}

interface IntegrationLinkAttemptRow {
  provider: IntegrationProvider;
  external_user_id: string;
  external_username: string | null;
  expires_at: string;
}

export class IntegrationLinkAttemptRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(params: {
    tokenHash: string;
    provider: IntegrationProvider;
    externalUserId: string;
    externalUsername: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO integration_link_attempts (
         token_hash,
         provider,
         external_user_id,
         external_username,
         expires_at
       )
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        params.tokenHash,
        params.provider,
        params.externalUserId,
        params.externalUsername,
        params.expiresAt,
      )
      .run();
  }

  async deleteForExternalUser(params: {
    provider: IntegrationProvider;
    externalUserId: string;
  }): Promise<void> {
    await this.database.prepare(
      `DELETE FROM integration_link_attempts
       WHERE provider = ? AND external_user_id = ?`,
    )
      .bind(params.provider, params.externalUserId)
      .run();
  }

  async consumeValid(params: {
    tokenHash: string;
    claimedUserId: string;
  }): Promise<IntegrationLinkAttemptRecord | null> {
    const row = await this.database.prepare(
      `UPDATE integration_link_attempts
       SET claimed_at = datetime('now'),
           claimed_user_id = ?
       WHERE token_hash = ?
         AND claimed_at IS NULL
         AND datetime(expires_at) > datetime('now')
       RETURNING provider, external_user_id, external_username, expires_at`,
    )
      .bind(params.claimedUserId, params.tokenHash)
      .first<IntegrationLinkAttemptRow>();

    return row ? rowToRecord(row) : null;
  }
}

function rowToRecord(row: IntegrationLinkAttemptRow): IntegrationLinkAttemptRecord {
  return {
    provider: row.provider,
    externalUserId: row.external_user_id,
    externalUsername: row.external_username,
    expiresAt: row.expires_at,
  };
}
