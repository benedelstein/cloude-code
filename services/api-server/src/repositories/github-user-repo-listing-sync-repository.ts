/**
 * Tracks when each user's full GitHub repo listing was last synced into D1.
 * The sync timestamp drives stale-while-revalidate on /repos and /repos/search.
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
      .first<{ synced_at: string }>();

    return row?.synced_at ?? null;
  }

  /**
   * Mark the user's full-listing cache as freshly synced.
   * @param userId Authenticated user id.
   * @param syncedAt ISO 8601 timestamp string for the sync.
   */
  async setSyncedAt(userId: string, syncedAt: string): Promise<void> {
    await this.database.prepare(
      `INSERT OR REPLACE INTO github_user_repo_listing_sync (user_id, synced_at)
       VALUES (?, ?)`,
    )
      .bind(userId, syncedAt)
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
