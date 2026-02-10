import { App } from "octokit";
import type { Env } from "@/types";

export type GitHubAppErrorCode =
  | "INSTALLATION_NOT_FOUND"
  | "REPO_NOT_ACCESSIBLE"
  | "GITHUB_API_ERROR";

export class GitHubAppError extends Error {
  constructor(
    public code: GitHubAppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitHubAppError";
  }
}

export class GitHubAppService {
  private app: App;
  private db: D1Database;

  constructor(env: Env) {
    this.app = new App({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      webhooks: { secret: env.GITHUB_WEBHOOK_SECRET },
    });
    this.db = env.DB;
  }

  /**
   * Resolve a repo (owner/name) to an installation access token.
   * Checks D1 for installation, verifies repo access, and returns a cached or fresh token.
   */
  async getTokenForRepo(repoId: string): Promise<string> {
    const [owner, repo] = repoId.split("/");
    if (!owner || !repo) {
      throw new GitHubAppError("REPO_NOT_ACCESSIBLE", `Invalid repoId: ${repoId}`);
    }

    const installation = await this.findInstallationForRepo(owner, repo);
    return this.getInstallationToken(installation.id, repo);
  }

  /**
   * Find the GitHub App installation for a given repo.
   * First checks D1, then falls back to the GitHub API.
   */
  async findInstallationForRepo(
    owner: string,
    repo: string,
  ): Promise<{ id: number; repository_selection: string }> {
    // Check D1 first
    const installation = await this.db
      .prepare(
        `SELECT id, repository_selection FROM github_installations
         WHERE account_login = ? AND suspended_at IS NULL`,
      )
      .bind(owner)
      .first<{ id: number; repository_selection: string }>();

    if (installation) {
      // If selection is "selected", verify this specific repo is accessible
      if (installation.repository_selection === "selected") {
        const repoRow = await this.db
          .prepare(
            `SELECT 1 FROM github_installation_repos
             WHERE installation_id = ? AND repo_name = ?`,
          )
          .bind(installation.id, `${owner}/${repo}`)
          .first();

        if (!repoRow) {
          throw new GitHubAppError(
            "REPO_NOT_ACCESSIBLE",
            `Repository ${owner}/${repo} is not accessible via the GitHub App installation`,
          );
        }
      }
      return installation;
    }

    // Fallback: query GitHub API directly
    try {
      const { data } = await this.app.octokit.rest.apps.getRepoInstallation({
        owner,
        repo,
      });

      return {
        id: data.id,
        repository_selection: data.repository_selection ?? "all",
      };
    } catch (error) {
      throw new GitHubAppError(
        "INSTALLATION_NOT_FOUND",
        `No GitHub App installation found for ${owner}/${repo}. Is the app installed on this account?`,
      );
    }
  }

  /**
   * Get an installation access token, using D1 cache with 5-minute buffer.
   */
  async getInstallationToken(
    installationId: number,
    repoName?: string,
  ): Promise<string> {
    // Check cache
    const cached = await this.db
      .prepare(
        `SELECT token, expires_at FROM installation_token_cache
         WHERE installation_id = ?
         AND datetime(expires_at) > datetime('now', '+5 minutes')`,
      )
      .bind(installationId)
      .first<{ token: string; expires_at: string }>();

    if (cached) {
      return cached.token;
    }

    // Generate new token via octokit, scoped to single repo with minimum permissions
    const octokit = await this.app.getInstallationOctokit(installationId);
    const { data } = await octokit.rest.apps.createInstallationAccessToken({
      installation_id: installationId,
      ...(repoName && { repositories: [repoName] }),
      permissions: {
        contents: "write",
        metadata: "read",
      },
    });

    // Cache it
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO installation_token_cache (installation_id, token, expires_at)
         VALUES (?, ?, ?)`,
      )
      .bind(installationId, data.token, data.expires_at)
      .run();

    return data.token;
  }

  // ============================================
  // Webhook handling
  // ============================================

  /**
   * Verify and dispatch a GitHub webhook event using octokit's built-in verification.
   */
  async handleWebhook(params: {
    id: string;
    name: string;
    signature: string;
    payload: string;
  }): Promise<void> {
    this.registerWebhookHandlers();

    await this.app.webhooks.verifyAndReceive({
      id: params.id,
      name: params.name as any,
      signature: params.signature,
      payload: params.payload,
    });
  }

  private registerWebhookHandlers(): void {
    this.app.webhooks.on("installation.created", async ({ payload }) => {
      await this.handleInstallationCreated(payload);
    });

    this.app.webhooks.on("installation.deleted", async ({ payload }) => {
      await this.handleInstallationDeleted(payload);
    });

    this.app.webhooks.on("installation.suspend", async ({ payload }) => {
      await this.handleInstallationSuspended(payload);
    });

    this.app.webhooks.on("installation.unsuspend", async ({ payload }) => {
      await this.handleInstallationUnsuspended(payload);
    });

    this.app.webhooks.on(
      "installation_repositories.added",
      async ({ payload }) => {
        await this.handleReposAdded(payload);
      },
    );

    this.app.webhooks.on(
      "installation_repositories.removed",
      async ({ payload }) => {
        await this.handleReposRemoved(payload);
      },
    );
  }

  private async handleInstallationCreated(payload: any): Promise<void> {
    const inst = payload.installation;
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO github_installations
         (id, app_id, account_id, account_login, account_type, target_type,
          permissions, events, repository_selection, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .bind(
        inst.id,
        inst.app_id,
        inst.account.id,
        inst.account.login,
        inst.account.type,
        inst.target_type,
        JSON.stringify(inst.permissions),
        JSON.stringify(inst.events),
        inst.repository_selection,
      )
      .run();

    // Insert selected repos if any
    if (payload.repositories && payload.repositories.length > 0) {
      const batch = payload.repositories.map((repo: any) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO github_installation_repos
             (installation_id, repo_id, repo_name)
             VALUES (?, ?, ?)`,
          )
          .bind(inst.id, repo.id, repo.full_name),
      );
      await this.db.batch(batch);
    }
  }

  private async handleInstallationDeleted(payload: any): Promise<void> {
    // CASCADE will clean up repos and token cache
    await this.db
      .prepare(`DELETE FROM github_installations WHERE id = ?`)
      .bind(payload.installation.id)
      .run();
  }

  private async handleInstallationSuspended(payload: any): Promise<void> {
    await this.db
      .prepare(
        `UPDATE github_installations SET suspended_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(payload.installation.id)
      .run();
  }

  private async handleInstallationUnsuspended(payload: any): Promise<void> {
    await this.db
      .prepare(
        `UPDATE github_installations SET suspended_at = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(payload.installation.id)
      .run();
  }

  private async handleReposAdded(payload: any): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_added;

    if (repos && repos.length > 0) {
      const batch = repos.map((repo: any) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO github_installation_repos
             (installation_id, repo_id, repo_name)
             VALUES (?, ?, ?)`,
          )
          .bind(installationId, repo.id, repo.full_name),
      );
      await this.db.batch(batch);
    }
  }

  private async handleReposRemoved(payload: any): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_removed;

    if (repos && repos.length > 0) {
      const batch = repos.map((repo: any) =>
        this.db
          .prepare(
            `DELETE FROM github_installation_repos
             WHERE installation_id = ? AND repo_id = ?`,
          )
          .bind(installationId, repo.id),
      );
      await this.db.batch(batch);
    }
  }
}
