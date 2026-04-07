import type { AuthMethod, ProviderId } from "@repo/shared";

export interface UserProviderCredentialRecord {
  userId: string;
  providerId: ProviderId;
  authMethod: AuthMethod;
  encryptedCredentials: string;
  requiresReauth: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserProviderCredentialRow {
  user_id: string;
  provider_id: ProviderId;
  auth_method: AuthMethod;
  encrypted_credentials: string;
  requires_reauth: number;
  created_at: string;
  updated_at: string;
}

export class UserProviderCredentialRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  /**
   * Upserts the stored credentials for a provider auth method.
   * @param input Credential row fields to persist.
   */
  async upsert(input: {
    userId: string;
    providerId: ProviderId;
    authMethod: AuthMethod;
    encryptedCredentials: string;
    requiresReauth: boolean;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO user_provider_credentials (
         user_id,
         provider_id,
         auth_method,
         encrypted_credentials,
         requires_reauth
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, provider_id, auth_method) DO UPDATE SET
         encrypted_credentials = excluded.encrypted_credentials,
         requires_reauth = excluded.requires_reauth,
         updated_at = datetime('now')`,
    )
      .bind(
        input.userId,
        input.providerId,
        input.authMethod,
        input.encryptedCredentials,
        input.requiresReauth ? 1 : 0,
      )
      .run();
  }

  /**
   * Fetches stored credentials for a specific provider auth method.
   * @param userId Authenticated user id.
   * @param providerId Provider identifier.
   * @param authMethod Provider auth method.
   * @returns The stored credential row, if present.
   */
  async getByUserProviderAndMethod(
    userId: string,
    providerId: ProviderId,
    authMethod: AuthMethod,
  ): Promise<UserProviderCredentialRecord | null> {
    const row = await this.database.prepare(
      `SELECT user_id,
              provider_id,
              auth_method,
              encrypted_credentials,
              requires_reauth,
              created_at,
              updated_at
       FROM user_provider_credentials
       WHERE user_id = ? AND provider_id = ? AND auth_method = ?`,
    )
      .bind(userId, providerId, authMethod)
      .first<UserProviderCredentialRow>();

    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      providerId: row.provider_id,
      authMethod: row.auth_method,
      encryptedCredentials: row.encrypted_credentials,
      requiresReauth: row.requires_reauth === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Marks a provider credential row as requiring reauthentication.
   * @param userId Authenticated user id.
   * @param providerId Provider identifier.
   * @param authMethod Provider auth method.
   */
  async markRequiresReauth(
    userId: string,
    providerId: ProviderId,
    authMethod: AuthMethod,
  ): Promise<void> {
    await this.database.prepare(
      `UPDATE user_provider_credentials
       SET requires_reauth = 1,
           updated_at = datetime('now')
       WHERE user_id = ? AND provider_id = ? AND auth_method = ?`,
    )
      .bind(userId, providerId, authMethod)
      .run();
  }

  /**
   * Deletes all stored credentials for a provider.
   * @param userId Authenticated user id.
   * @param providerId Provider identifier.
   */
  async deleteByUserAndProvider(
    userId: string,
    providerId: ProviderId,
  ): Promise<void> {
    await this.database.prepare(
      `DELETE FROM user_provider_credentials
       WHERE user_id = ? AND provider_id = ?`,
    )
      .bind(userId, providerId)
      .run();
  }
}
