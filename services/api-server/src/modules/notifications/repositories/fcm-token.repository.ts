import { fromSqliteDatetime } from "@/shared/utils/utils";
import type { FcmToken } from "../types/notification.types";

interface FcmTokenRow {
  user_id: string;
  device_id: string;
  token: string;
  platform: "ios";
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

function rowToToken(row: FcmTokenRow): FcmToken {
  return {
    userId: row.user_id,
    deviceId: row.device_id,
    token: row.token,
    platform: row.platform,
    createdAt: fromSqliteDatetime(row.created_at),
    updatedAt: fromSqliteDatetime(row.updated_at),
    lastSeenAt: fromSqliteDatetime(row.last_seen_at),
  };
}

export class FcmTokenRepository {
  constructor(private readonly database: D1Database) {}

  async upsert(params: {
    userId: string;
    deviceId: string;
    token: string;
    platform: "ios";
  }): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          `DELETE FROM fcm_tokens
           WHERE token = ? AND NOT (user_id = ? AND device_id = ?)`,
        )
        .bind(params.token, params.userId, params.deviceId),
      this.database
        .prepare(
          `INSERT INTO fcm_tokens (
             user_id,
             device_id,
             token,
             platform
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, device_id) DO UPDATE SET
             token = excluded.token,
             platform = excluded.platform,
             updated_at = datetime('now'),
             last_seen_at = datetime('now')`,
        )
        .bind(params.userId, params.deviceId, params.token, params.platform),
    ]);
  }

  async listActiveForUser(userId: string): Promise<FcmToken[]> {
    const result = await this.database
      .prepare(
        `SELECT *
         FROM fcm_tokens
         WHERE user_id = ?
         ORDER BY updated_at DESC, device_id ASC`,
      )
      .bind(userId)
      .all<FcmTokenRow>();

    return (result.results ?? []).map(rowToToken);
  }

  async deleteToken(token: string): Promise<void> {
    await this.database
      .prepare(
        `DELETE FROM fcm_tokens
         WHERE token = ?`,
      )
      .bind(token)
      .run();
  }
}
