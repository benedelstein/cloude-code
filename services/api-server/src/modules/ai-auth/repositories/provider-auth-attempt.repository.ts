import type { AuthMethod, ProviderId } from "@repo/shared";

export interface ProviderAuthAttemptRecord {
  id: string;
  userId: string;
  providerId: ProviderId;
  authMethod: AuthMethod;
  flowType: string;
  encryptedContextJson: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface ProviderAuthAttemptRow {
  id: string;
  user_id: string;
  provider_id: ProviderId;
  auth_method: AuthMethod;
  flow_type: string;
  encrypted_context_json: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export class ProviderAuthAttemptRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  /**
   * Creates or replaces a provider auth attempt row.
   * @param input Attempt record fields.
   */
  async upsert(input: {
    id: string;
    userId: string;
    providerId: ProviderId;
    authMethod: AuthMethod;
    flowType: string;
    encryptedContextJson: string;
    expiresAt: string;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO provider_auth_attempts (
         id,
         user_id,
         provider_id,
         auth_method,
         flow_type,
         encrypted_context_json,
         expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         user_id = excluded.user_id,
         provider_id = excluded.provider_id,
         auth_method = excluded.auth_method,
         flow_type = excluded.flow_type,
         encrypted_context_json = excluded.encrypted_context_json,
         expires_at = excluded.expires_at,
         updated_at = datetime('now')`,
    )
      .bind(
        input.id,
        input.userId,
        input.providerId,
        input.authMethod,
        input.flowType,
        input.encryptedContextJson,
        input.expiresAt,
      )
      .run();
  }

  /**
   * Fetches a provider auth attempt by id and owner.
   * @param id Attempt id.
   * @param userId Authenticated user id.
   * @returns Matching attempt row, if present.
   */
  async getByIdAndUserId(
    id: string,
    userId: string,
  ): Promise<ProviderAuthAttemptRecord | null> {
    const row = await this.database.prepare(
      `SELECT id,
              user_id,
              provider_id,
              auth_method,
              flow_type,
              encrypted_context_json,
              expires_at,
              created_at,
              updated_at
       FROM provider_auth_attempts
       WHERE id = ? AND user_id = ?`,
    )
      .bind(id, userId)
      .first<ProviderAuthAttemptRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      providerId: row.provider_id,
      authMethod: row.auth_method,
      flowType: row.flow_type,
      encryptedContextJson: row.encrypted_context_json,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Deletes a provider auth attempt row.
   * @param id Attempt id.
   */
  async deleteById(id: string): Promise<void> {
    await this.database.prepare(
      `DELETE FROM provider_auth_attempts WHERE id = ?`,
    )
      .bind(id)
      .run();
  }
}
