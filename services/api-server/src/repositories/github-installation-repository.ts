export type RepositorySelection = "all" | "selected";

export interface GitHubInstallation {
  id: number;
  appId: number;
  accountId: number;
  accountLogin: string;
  accountType: string;
  targetType: string;
  permissions: string; // JSON
  events: string; // JSON
  repositorySelection: RepositorySelection;
  createdAt: string;
  updatedAt: string;
  suspendedAt: string | null;
}

export interface GitHubInstallationRepo {
  installationId: number;
  repoId: number;
  repoName: string; // "owner/repo"
}

export interface GitHubInstallationWithRepo {
  id: number;
  repositorySelection: RepositorySelection;
}

interface GitHubInstallationRepoRow {
  installation_id: number;
  repo_id: number;
  repo_name: string;
}

interface GitHubInstallationWithRepoRow {
  id: number;
  repository_selection: RepositorySelection;
}

export interface UpsertInstallationInput {
  id: number;
  appId: number;
  accountId: number;
  accountLogin: string;
  accountType: string;
  targetType: string;
  permissions: string;
  events: string;
  repositorySelection: RepositorySelection;
}

export class GitHubInstallationRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async findByAccountLogin(login: string): Promise<GitHubInstallationWithRepo | null> {
    const row = await this.database.prepare(
      `SELECT id, repository_selection FROM github_installations
       WHERE account_login = ? AND suspended_at IS NULL`,
    )
      .bind(login)
      .first<GitHubInstallationWithRepoRow>();

    if (!row) return null;

    return {
      id: row.id,
      repositorySelection: row.repository_selection,
    };
  }

  async findByRepoId(repoId: number): Promise<GitHubInstallationWithRepo | null> {
    const row = await this.database.prepare(
      `SELECT installations.id, installations.repository_selection
       FROM github_installation_repos repos
       JOIN github_installations installations
         ON installations.id = repos.installation_id
       WHERE repos.repo_id = ?
         AND installations.suspended_at IS NULL
       LIMIT 1`,
    )
      .bind(repoId)
      .first<GitHubInstallationWithRepoRow>();

    if (!row) return null;

    return {
      id: row.id,
      repositorySelection: row.repository_selection,
    };
  }

  async findRepo(installationId: number, repoName: string): Promise<GitHubInstallationRepo | null> {
    const row = await this.database.prepare(
      `SELECT installation_id, repo_id, repo_name FROM github_installation_repos
       WHERE installation_id = ? AND repo_name = ?`,
    )
      .bind(installationId, repoName)
      .first<GitHubInstallationRepoRow>();

    if (!row) return null;

    return {
      installationId: row.installation_id,
      repoId: row.repo_id,
      repoName: row.repo_name,
    };
  }

  async findInstallationRepoById(repoId: number): Promise<GitHubInstallationRepo | null> {
    const row = await this.database.prepare(
      `SELECT installation_id, repo_id, repo_name FROM github_installation_repos
       WHERE repo_id = ?`,
    )
      .bind(repoId)
      .first<GitHubInstallationRepoRow>();

    if (!row) return null;

    return {
      installationId: row.installation_id,
      repoId: row.repo_id,
      repoName: row.repo_name,
    };
  }

  async upsert(input: UpsertInstallationInput): Promise<void> {
    await this.database.prepare(
      `INSERT OR REPLACE INTO github_installations
       (id, app_id, account_id, account_login, account_type, target_type,
        permissions, events, repository_selection, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(
        input.id,
        input.appId,
        input.accountId,
        input.accountLogin,
        input.accountType,
        input.targetType,
        input.permissions,
        input.events,
        input.repositorySelection,
      )
      .run();
  }

  async delete(installationId: number): Promise<void> {
    // CASCADE will clean up repos and token cache
    await this.database.prepare(`DELETE FROM github_installations WHERE id = ?`)
      .bind(installationId)
      .run();
  }

  async setSuspended(installationId: number, suspended: boolean): Promise<void> {
    if (suspended) {
      await this.database.prepare(
        `UPDATE github_installations SET suspended_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(installationId)
        .run();
    } else {
      await this.database.prepare(
        `UPDATE github_installations SET suspended_at = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(installationId)
        .run();
    }
  }

  async addRepos(
    installationId: number,
    repos: Array<{ id: number; fullName: string }>,
  ): Promise<void> {
    if (repos.length === 0) return;

    const batch = repos.map((repo) =>
      this.database.prepare(
        `INSERT OR IGNORE INTO github_installation_repos
         (installation_id, repo_id, repo_name)
         VALUES (?, ?, ?)`,
      ).bind(installationId, repo.id, repo.fullName),
    );
    await this.database.batch(batch);
  }

  async removeRepos(installationId: number, repoIds: number[]): Promise<void> {
    if (repoIds.length === 0) return;

    const batch = repoIds.map((repoId) =>
      this.database.prepare(
        `DELETE FROM github_installation_repos
         WHERE installation_id = ? AND repo_id = ?`,
      ).bind(installationId, repoId),
    );
    await this.database.batch(batch);
  }
}
