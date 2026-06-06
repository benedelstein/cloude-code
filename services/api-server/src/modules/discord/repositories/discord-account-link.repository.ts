export interface DiscordAccountLinkRecord {
  discordUserId: string;
  userId: string;
  discordUsername: string | null;
  expiresAt: string;
}

interface DiscordAccountLinkRow {
  discord_user_id: string;
  user_id: string;
  discord_username: string | null;
  expires_at: string;
}

export class DiscordAccountLinkRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async getActiveByDiscordUserId(
    discordUserId: string,
  ): Promise<DiscordAccountLinkRecord | null> {
    const row = await this.database.prepare(
      `SELECT discord_user_id, user_id, discord_username, expires_at
       FROM discord_account_links
       WHERE discord_user_id = ?
         AND revoked_at IS NULL
         AND datetime(expires_at) > datetime('now')`,
    )
      .bind(discordUserId)
      .first<DiscordAccountLinkRow>();

    return row ? rowToRecord(row) : null;
  }

  async upsert(params: {
    discordUserId: string;
    userId: string;
    discordUsername: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO discord_account_links (
         discord_user_id,
         user_id,
         discord_username,
         expires_at,
         revoked_at
       )
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(discord_user_id) DO UPDATE SET
         user_id = excluded.user_id,
         discord_username = excluded.discord_username,
         expires_at = excluded.expires_at,
         revoked_at = NULL,
         updated_at = datetime('now')`,
    )
      .bind(
        params.discordUserId,
        params.userId,
        params.discordUsername,
        params.expiresAt,
      )
      .run();
  }

  async touchLastUsed(params: {
    discordUserId: string;
    discordUsername: string | null;
  }): Promise<void> {
    await this.database.prepare(
      `UPDATE discord_account_links
       SET last_used_at = datetime('now'),
           discord_username = COALESCE(?, discord_username),
           updated_at = datetime('now')
       WHERE discord_user_id = ?`,
    )
      .bind(params.discordUsername, params.discordUserId)
      .run();
  }
}

function rowToRecord(row: DiscordAccountLinkRow): DiscordAccountLinkRecord {
  return {
    discordUserId: row.discord_user_id,
    userId: row.user_id,
    discordUsername: row.discord_username,
    expiresAt: row.expires_at,
  };
}
