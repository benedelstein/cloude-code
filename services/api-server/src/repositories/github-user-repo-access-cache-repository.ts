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
       (user_id, installation_id, repo_id, allowed, repo_full_name, expires_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, datetime('now'))`,
    )
      .bind(
        userId,
        installationId,
        repository.id,
        repository.fullName,
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
       (user_id, installation_id, repo_id, allowed, repo_full_name, expires_at, updated_at)
       VALUES (?, ?, ?, 0, NULL, ?, datetime('now'))`,
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
      this.database.prepare(
        `INSERT OR REPLACE INTO github_user_repo_access_cache
         (user_id, installation_id, repo_id, allowed, repo_full_name, expires_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, datetime('now'))`,
      )
        .bind(
          userId,
          installationId,
          repository.id,
          repository.fullName,
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
      this.database.prepare(
        `INSERT OR REPLACE INTO github_user_repo_access_cache
         (user_id, installation_id, repo_id, allowed, repo_full_name, expires_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, datetime('now'))`,
      )
        .bind(
          userId,
          entry.installationId,
          entry.repository.id,
          entry.repository.fullName,
          expiresAt,
        ),
    );

    await this.database.batch(batch);
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
}
