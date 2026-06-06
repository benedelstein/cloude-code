export interface DiscordLinkAttemptRecord {
  discordUserId: string;
  discordUsername: string | null;
  expiresAt: string;
}

interface DiscordLinkAttemptRow {
  discord_user_id: string;
  discord_username: string | null;
  expires_at: string;
}

export class DiscordLinkAttemptRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(params: {
    tokenHash: string;
    discordUserId: string;
    discordUsername: string | null;
    guildId: string | null;
    channelId: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO discord_link_attempts (
         token_hash,
         discord_user_id,
         discord_username,
         guild_id,
         channel_id,
         expires_at
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        params.tokenHash,
        params.discordUserId,
        params.discordUsername,
        params.guildId,
        params.channelId,
        params.expiresAt,
      )
      .run();
  }

  async consumeValid(params: {
    tokenHash: string;
    claimedUserId: string;
  }): Promise<DiscordLinkAttemptRecord | null> {
    const row = await this.database.prepare(
      `UPDATE discord_link_attempts
       SET claimed_at = datetime('now'),
           claimed_user_id = ?
       WHERE token_hash = ?
         AND claimed_at IS NULL
         AND datetime(expires_at) > datetime('now')
       RETURNING discord_user_id, discord_username, expires_at`,
    )
      .bind(params.claimedUserId, params.tokenHash)
      .first<DiscordLinkAttemptRow>();

    return row ? rowToRecord(row) : null;
  }
}

function rowToRecord(row: DiscordLinkAttemptRow): DiscordLinkAttemptRecord {
  return {
    discordUserId: row.discord_user_id,
    discordUsername: row.discord_username,
    expiresAt: row.expires_at,
  };
}
