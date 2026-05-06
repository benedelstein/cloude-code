import type { Repo } from "@repo/shared";
import type { GitHubRepositoryData } from "@/lib/github/github-app";

export interface GitHubUserRepoAccessCacheEntry {
  userId: string;
  installationId: number;
  repoId: number;
  allowed: boolean;
  repoFullName: string | null;
  expiresAt: string;
}

interface GitHubUserRepoAccessCacheRow {
  user_id: string;
  installation_id: number;
  repo_id: number;
  allowed: number;
  repo_full_name: string | null;
  expires_at: string;
}

interface GitHubUserRepoListingRow {
  installation_id: number;
  repo_id: number;
  repo_full_name: string;
  owner: string | null;
  name: string | null;
  default_branch: string | null;
  is_private: number | null;
  description: string | null;
}

export class GitHubUserRepoAccessCacheRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async get(
    userId: string,
    installationId: number,
    repoId: number,
  ): Promise<GitHubUserRepoAccessCacheEntry | null> {
    const row = await this.database.prepare(
      `SELECT user_id, installation_id, repo_id, allowed, repo_full_name, expires_at
       FROM github_user_repo_access_cache
       WHERE user_id = ? AND installation_id = ? AND repo_id = ?
         AND datetime(expires_at) > datetime('now')`,
    )
      .bind(userId, installationId, repoId)
      .first<GitHubUserRepoAccessCacheRow>();

    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      installationId: row.installation_id,
      repoId: row.repo_id,
      allowed: row.allowed === 1,
      repoFullName: row.repo_full_name,
      expiresAt: row.expires_at,
    };
  }

  async setAllowed(
    userId: string,
    installationId: number,
    repository: GitHubRepositoryData,
    expiresAt: string,
  ): Promise<void> {
    await this.database.prepare(
      `INSERT OR REPLACE INTO github_user_repo_access_cache
       (user_id, installation_id, repo_id, allowed, repo_full_name,
        owner, name, default_branch, is_private, description,
        expires_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        userId,
        installationId,
        repository.id,
        repository.fullName,
        repository.owner,
        repository.name,
        repository.defaultBranch ?? null,
        encodePrivateFlag(repository.private),
        repository.description ?? null,
        expiresAt,
      )
      .run();
  }

  async setDenied(
    userId: string,
    installationId: number,
    repoId: number,
    expiresAt: string,
  ): Promise<void> {
    await this.database.prepare(
      `INSERT OR REPLACE INTO github_user_repo_access_cache
       (user_id, installation_id, repo_id, allowed, repo_full_name,
        owner, name, default_branch, is_private, description,
        expires_at, updated_at)
       VALUES (?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, datetime('now'))`,
    )
      .bind(userId, installationId, repoId, expiresAt)
      .run();
  }

  async setAllowedMany(
    userId: string,
    installationId: number,
    repositories: GitHubRepositoryData[],
    expiresAt: string,
  ): Promise<void> {
    if (repositories.length === 0) {
      return;
    }

    const batch = repositories.map((repository) =>
      this.buildAllowedUpsertStatement(
        userId,
        installationId,
        repository,
        expiresAt,
      ),
    );

    await this.database.batch(batch);
  }

  async setAllowedEntries(
    userId: string,
    entries: Array<{
      installationId: number;
      repository: GitHubRepositoryData;
    }>,
    expiresAt: string,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const batch = entries.map((entry) =>
      this.buildAllowedUpsertStatement(
        userId,
        entry.installationId,
        entry.repository,
        expiresAt,
      ),
    );

    await this.database.batch(batch);
  }

  /**
   * Atomically replace the cached allowed-listing rows for a single
   * (user, installation) pair. Upserts every entry and deletes any prior rows
   * for this user+installation not present in the new set. Other installations
   * are untouched, so a transient failure on one installation cannot wipe
   * cached data for the user's other installations.
   *
   * @param userId Authenticated user id.
   * @param installationId GitHub installation id.
   * @param repositories Repos the user can access in this installation.
   * @param expiresAt ISO 8601 expiry for each row.
   */
  async replaceAllowedListingForUserInstallation(
    userId: string,
    installationId: number,
    repositories: GitHubRepositoryData[],
    expiresAt: string,
  ): Promise<void> {
    const upserts = repositories.map((repository) =>
      this.buildAllowedUpsertStatement(
        userId,
        installationId,
        repository,
        expiresAt,
      ),
    );

    const keepRepoIds = new Set(repositories.map((repository) => repository.id));

    // Read existing rows for this user+installation to compute deletes.
    // D1 doesn't have a portable NOT IN tuple form, so we enumerate-and-filter.
    const existingRows = await this.database.prepare(
      `SELECT repo_id FROM github_user_repo_access_cache
       WHERE user_id = ? AND installation_id = ? AND allowed = 1`,
    )
      .bind(userId, installationId)
      .all<{ repo_id: number }>();

    const deletes = (existingRows.results ?? [])
      .filter((row) => !keepRepoIds.has(row.repo_id))
      .map((row) =>
        this.database.prepare(
          `DELETE FROM github_user_repo_access_cache
           WHERE user_id = ? AND installation_id = ? AND repo_id = ?`,
        )
          .bind(userId, installationId, row.repo_id),
      );

    const batch = [...upserts, ...deletes];
    if (batch.length === 0) {
      return;
    }
    await this.database.batch(batch);
  }

  /**
   * Delete cached allowed-listing rows for a user that belong to installations
   * NOT in the given allowlist. Used after a full sync to prune installations
   * the user has lost access to (e.g. removed from an org). Safe to call only
   * after the authoritative installations list has been fetched from GitHub.
   *
   * @param userId Authenticated user id.
   * @param installationIds Installation ids to keep.
   */
  async deleteByUserExceptInstallationIds(
    userId: string,
    installationIds: number[],
  ): Promise<void> {
    if (installationIds.length === 0) {
      await this.database.prepare(
        `DELETE FROM github_user_repo_access_cache WHERE user_id = ?`,
      )
        .bind(userId)
        .run();
      return;
    }

    const placeholders = installationIds.map(() => "?").join(", ");
    await this.database.prepare(
      `DELETE FROM github_user_repo_access_cache
       WHERE user_id = ?
         AND installation_id NOT IN (${placeholders})`,
    )
      .bind(userId, ...installationIds)
      .run();
  }

  /**
   * Read a page of allowed repos for a user, ordered by repo full name.
   * Cursor is the last `repo_full_name` of the previous page.
   * @param userId Authenticated user id.
   * @param cursor Last repo_full_name from the previous page, or null for first page.
   * @param limit Page size.
   * @returns Page rows in stable case-insensitive name order.
   */
  async listAllowedByUserPaged(
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<GitHubUserRepoListingRow[]> {
    const sql = cursor === null
      ? `SELECT installation_id, repo_id, repo_full_name, owner, name,
                default_branch, is_private, description
         FROM github_user_repo_access_cache
         WHERE user_id = ? AND allowed = 1 AND repo_full_name IS NOT NULL
         ORDER BY repo_full_name COLLATE NOCASE ASC
         LIMIT ?`
      : `SELECT installation_id, repo_id, repo_full_name, owner, name,
                default_branch, is_private, description
         FROM github_user_repo_access_cache
         WHERE user_id = ? AND allowed = 1 AND repo_full_name IS NOT NULL
           AND repo_full_name COLLATE NOCASE > ? COLLATE NOCASE
         ORDER BY repo_full_name COLLATE NOCASE ASC
         LIMIT ?`;

    const statement = cursor === null
      ? this.database.prepare(sql).bind(userId, limit)
      : this.database.prepare(sql).bind(userId, cursor, limit);

    const result = await statement.all<GitHubUserRepoListingRow>();
    return result.results ?? [];
  }

  /**
   * Search allowed repos for a user by case-insensitive substring match on full name.
   * @param userId Authenticated user id.
   * @param query Search substring (matched anywhere within repo_full_name).
   * @param limit Result cap.
   * @returns Matching rows in stable case-insensitive name order.
   */
  async searchAllowedByUser(
    userId: string,
    query: string,
    limit: number,
  ): Promise<GitHubUserRepoListingRow[]> {
    const escaped = escapeLikeWildcards(query);
    const result = await this.database.prepare(
      `SELECT installation_id, repo_id, repo_full_name, owner, name,
              default_branch, is_private, description
       FROM github_user_repo_access_cache
       WHERE user_id = ? AND allowed = 1 AND repo_full_name IS NOT NULL
         AND repo_full_name LIKE ? ESCAPE '\\' COLLATE NOCASE
       ORDER BY repo_full_name COLLATE NOCASE ASC
       LIMIT ?`,
    )
      .bind(userId, `%${escaped}%`, limit)
      .all<GitHubUserRepoListingRow>();

    return result.results ?? [];
  }

  async deleteByInstallationId(installationId: number): Promise<void> {
    await this.database.prepare(
      `DELETE FROM github_user_repo_access_cache WHERE installation_id = ?`,
    )
      .bind(installationId)
      .run();
  }

  async deleteByInstallationIdAndRepoIds(
    installationId: number,
    repoIds: number[],
  ): Promise<void> {
    if (repoIds.length === 0) {
      return;
    }

    const placeholders = repoIds.map(() => "?").join(", ");
    await this.database.prepare(
      `DELETE FROM github_user_repo_access_cache
       WHERE installation_id = ?
         AND repo_id IN (${placeholders})`,
    )
      .bind(installationId, ...repoIds)
      .run();
  }

  /**
   * Delete cached repo-access rows for an installation except a repo-id allowlist.
   * @param installationId The GitHub installation id to clean up.
   * @param repoIds The repo ids whose cache rows should be preserved.
   * @returns A promise that resolves when the cleanup completes.
   */
  async deleteByInstallationIdExceptRepoIds(
    installationId: number,
    repoIds: number[],
  ): Promise<void> {
    if (repoIds.length === 0) {
      await this.deleteByInstallationId(installationId);
      return;
    }

    const placeholders = repoIds.map(() => "?").join(", ");
    await this.database.prepare(
      `DELETE FROM github_user_repo_access_cache
       WHERE installation_id = ?
         AND repo_id NOT IN (${placeholders})`,
    )
      .bind(installationId, ...repoIds)
      .run();
  }

  private buildAllowedUpsertStatement(
    userId: string,
    installationId: number,
    repository: GitHubRepositoryData,
    expiresAt: string,
  ): D1PreparedStatement {
    return this.database.prepare(
      `INSERT OR REPLACE INTO github_user_repo_access_cache
       (user_id, installation_id, repo_id, allowed, repo_full_name,
        owner, name, default_branch, is_private, description,
        expires_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        userId,
        installationId,
        repository.id,
        repository.fullName,
        repository.owner,
        repository.name,
        repository.defaultBranch ?? null,
        encodePrivateFlag(repository.private),
        repository.description ?? null,
        expiresAt,
      );
  }
}

function encodePrivateFlag(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

function escapeLikeWildcards(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Project a listing row into a Repo shape for the API response.
 * Falls back to deriving owner/name from `repo_full_name` if those columns
 * are NULL for legacy rows that pre-date the listing-columns migration.
 */
export function listingRowToRepo(row: GitHubUserRepoListingRow): Repo | null {
  const fullName = row.repo_full_name;
  let owner = row.owner;
  let name = row.name;
  if (!owner || !name) {
    const [parsedOwner, parsedName] = fullName.split("/");
    if (!parsedOwner || !parsedName) return null;
    owner = parsedOwner;
    name = parsedName;
  }

  return {
    id: row.repo_id,
    name,
    fullName,
    owner,
    private: row.is_private === 1,
    description: row.description,
    defaultBranch: row.default_branch ?? "",
  };
}

export type { GitHubUserRepoListingRow };
