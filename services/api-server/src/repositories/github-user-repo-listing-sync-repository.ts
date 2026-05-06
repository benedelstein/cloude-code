/**
 * Tracks when each user's full GitHub repo listing was last synced into D1.
 * The sync timestamp drives stale-while-revalidate on /repos and /repos/search.
 *
 * Also serves as a per-user advisory lock for fullSync via `sync_started_at`,
 * so multiple concurrent requests from the same user don't kick off redundant
 * GitHub enumerations.
 */
export class GitHubUserRepoListingSyncRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  /**
   * Get the last full-sync timestamp for a user.
   * @param userId Authenticated user id.
   * @returns ISO 8601 timestamp string, or null if the user has never been synced.
   */
  async getSyncedAt(userId: string): Promise<string | null> {
    const row = await this.database.prepare(
      `SELECT synced_at FROM github_user_repo_listing_sync WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ synced_at: string | null }>();

    return row?.synced_at ?? null;
  }

  /**
   * Mark the user's full-listing cache as freshly synced and release any active
   * claim. Single statement so success-path lock release is atomic with the
   * marker advance.
   * @param userId Authenticated user id.
   * @param syncedAt ISO 8601 timestamp string for the sync.
   */
  async setSyncedAt(userId: string, syncedAt: string): Promise<void> {
    await this.database.prepare(
      `INSERT INTO github_user_repo_listing_sync (user_id, synced_at, sync_started_at)
       VALUES (?, ?, NULL)
       ON CONFLICT(user_id) DO UPDATE
         SET synced_at = excluded.synced_at, sync_started_at = NULL`,
    )
      .bind(userId, syncedAt)
      .run();
  }

  /**
   * Atomically claim the per-user fullSync slot. Wins if no claim is currently
   * held, or if the previous claim is older than `staleClaimAfterMs` (treated
   * as a crashed sync). Uses a single ON CONFLICT statement so the
   * check-and-set is one DB round trip with no race window.
   *
   * @param userId Authenticated user id.
   * @param now ISO 8601 timestamp for this claim.
   * @param staleClaimAfterMs Claims older than this are considered crashed
   *   and overridable, so a failed sync that didn't release the lock can't
   *   block subsequent attempts forever.
   * @returns true if this caller now holds the claim, false if another caller does.
   */
  async tryClaimSync(
    userId: string,
    now: string,
    staleClaimAfterMs: number,
  ): Promise<boolean> {
    const staleCutoff = new Date(Date.now() - staleClaimAfterMs).toISOString();
    const result = await this.database.prepare(
      `INSERT INTO github_user_repo_listing_sync (user_id, synced_at, sync_started_at)
       VALUES (?, NULL, ?)
       ON CONFLICT(user_id) DO UPDATE
         SET sync_started_at = excluded.sync_started_at
         WHERE github_user_repo_listing_sync.sync_started_at IS NULL
            OR github_user_repo_listing_sync.sync_started_at < ?`,
    )
      .bind(userId, now, staleCutoff)
      .run();

    return (result.meta.changes ?? 0) > 0;
  }

  /**
   * Release the claim without touching synced_at. Call this on fullSync failure
   * paths so the next request can retry immediately rather than waiting for the
   * stale-claim TTL to expire. Success paths use setSyncedAt, which already
   * clears sync_started_at in the same statement.
   */
  async releaseSyncClaim(userId: string): Promise<void> {
    await this.database.prepare(
      `UPDATE github_user_repo_listing_sync
       SET sync_started_at = NULL
       WHERE user_id = ?`,
    )
      .bind(userId)
      .run();
  }

  /**
   * Clear the user's sync marker so the next request triggers a fresh full sync.
   */
  async clear(userId: string): Promise<void> {
    await this.database.prepare(
      `DELETE FROM github_user_repo_listing_sync WHERE user_id = ?`,
    )
      .bind(userId)
      .run();
  }

  /**
   * Clear sync markers for every user that currently has any cached access rows
   * for the given installation. Used after installation webhook events so the
   * next /repos request triggers a fresh full sync for affected users.
   *
   * NOTE: must run BEFORE the access cache rows are deleted by the webhook handler,
   * otherwise the inner SELECT will find no users to invalidate.
   */
  async clearForInstallation(installationId: number): Promise<void> {
    await this.database.prepare(
      `DELETE FROM github_user_repo_listing_sync
       WHERE user_id IN (
         SELECT DISTINCT user_id FROM github_user_repo_access_cache
         WHERE installation_id = ?
       )`,
    )
      .bind(installationId)
      .run();
  }
}
