import { timingSafeCompare } from "@/shared/utils/crypto";

export type SignInClientType = "web" | "native";

export type SignInAttemptStatus =
  | "awaiting_oauth"
  | "identity_ready"
  | "claimed"
  | "failed";

export interface SignInAttemptRecord {
  id: string;
  clientType: SignInClientType;
  status: SignInAttemptStatus;
  userId: string | null;
  /** Web: the allowlisted origin. Native: the allowlisted custom-scheme URI. */
  completionTarget: string;
  /** Web only: the validated relative path to return to once sign-in settles. */
  returnTo: string | null;
  /** Set when the OAuth callback chains a GitHub App installation navigation. */
  installUrl: string | null;
  expiresAt: string;
}

interface SignInAttemptRow {
  id: string;
  client_type: SignInClientType;
  claim_token_hash: string;
  status: SignInAttemptStatus;
  user_id: string | null;
  completion_target: string;
  return_to: string | null;
  install_url: string | null;
  expires_at: string;
}

/**
 * Server-owned GitHub sign-in attempts.
 *
 * An attempt outlives the OAuth state row: it carries the identity transition
 * through optional GitHub App installation until the initiating client adapter
 * claims it with its raw claim token. Only the claim token's SHA-256 hash is
 * stored, and lookups compare it in constant time before any status is
 * disclosed.
 */
export class SignInAttemptRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(input: {
    id: string;
    clientType: SignInClientType;
    claimTokenHash: string;
    completionTarget: string;
    returnTo: string | null;
    expiresAt: string;
  }): Promise<void> {
    await this.database.prepare(
      `INSERT INTO sign_in_attempts (
         id,
         client_type,
         claim_token_hash,
         status,
         completion_target,
         return_to,
         expires_at
       ) VALUES (?, ?, ?, 'awaiting_oauth', ?, ?, ?)`,
    )
      .bind(
        input.id,
        input.clientType,
        input.claimTokenHash,
        input.completionTarget,
        input.returnTo,
        input.expiresAt,
      )
      .run();
  }

  /** Reads an unexpired attempt without verifying the claim token. */
  async getUnexpired(id: string): Promise<SignInAttemptRecord | null> {
    const row = await this.database.prepare(
      `SELECT id,
              client_type,
              claim_token_hash,
              status,
              user_id,
              completion_target,
              return_to,
              install_url,
              expires_at
       FROM sign_in_attempts
       WHERE id = ? AND datetime(expires_at) > datetime('now')`,
    )
      .bind(id)
      .first<SignInAttemptRow>();

    return row ? toRecord(row) : null;
  }

  /**
   * Reads an unexpired attempt only when the presented claim-token hash
   * matches, so a caller without the token learns nothing about its status.
   */
  async getUnexpiredByClaimTokenHash(
    id: string,
    claimTokenHash: string,
  ): Promise<SignInAttemptRecord | null> {
    const row = await this.database.prepare(
      `SELECT id,
              client_type,
              claim_token_hash,
              status,
              user_id,
              completion_target,
              return_to,
              install_url,
              expires_at
       FROM sign_in_attempts
       WHERE id = ? AND datetime(expires_at) > datetime('now')`,
    )
      .bind(id)
      .first<SignInAttemptRow>();

    if (!row || !timingSafeCompare(row.claim_token_hash, claimTokenHash)) {
      return null;
    }

    return toRecord(row);
  }

  /** Attaches the authenticated user and makes the attempt claimable. */
  async markIdentityReady(input: {
    id: string;
    userId: string;
    installUrl: string | null;
  }): Promise<void> {
    await this.database.prepare(
      `UPDATE sign_in_attempts
       SET status = 'identity_ready',
           user_id = ?,
           install_url = ?,
           updated_at = datetime('now')
       WHERE id = ? AND status = 'awaiting_oauth'`,
    )
      .bind(input.userId, input.installUrl, input.id)
      .run();
  }

  async markFailed(id: string): Promise<void> {
    await this.database.prepare(
      `UPDATE sign_in_attempts
       SET status = 'failed', updated_at = datetime('now')
       WHERE id = ? AND status = 'awaiting_oauth'`,
    )
      .bind(id)
      .run();
  }

  /**
   * Claims an identity-ready attempt exactly once. The conditional update is
   * the concurrency guard: two racing completions both read `identity_ready`,
   * but only the first `UPDATE ... WHERE status = 'identity_ready'` returns a
   * row, so only that request can issue a session.
   */
  async claim(input: {
    id: string;
    claimTokenHash: string;
    clientType: SignInClientType;
  }): Promise<SignInAttemptRecord | null> {
    const row = await this.database.prepare(
      `UPDATE sign_in_attempts
       SET status = 'claimed', updated_at = datetime('now')
       WHERE id = ?
         AND claim_token_hash = ?
         AND client_type = ?
         AND status = 'identity_ready'
         AND datetime(expires_at) > datetime('now')
       RETURNING id,
                 client_type,
                 claim_token_hash,
                 status,
                 user_id,
                 completion_target,
                 return_to,
                 install_url,
                 expires_at`,
    )
      .bind(input.id, input.claimTokenHash, input.clientType)
      .first<SignInAttemptRow>();

    return row ? toRecord(row) : null;
  }

  /** Bounds storage: attempts are short-lived and never read after expiry. */
  async deleteExpired(): Promise<void> {
    await this.database.prepare(
      `DELETE FROM sign_in_attempts WHERE datetime(expires_at) <= datetime('now')`,
    )
      .run();
  }
}

function toRecord(row: SignInAttemptRow): SignInAttemptRecord {
  return {
    id: row.id,
    clientType: row.client_type,
    status: row.status,
    userId: row.user_id ?? null,
    completionTarget: row.completion_target,
    returnTo: row.return_to ?? null,
    installUrl: row.install_url ?? null,
    expiresAt: row.expires_at,
  };
}
