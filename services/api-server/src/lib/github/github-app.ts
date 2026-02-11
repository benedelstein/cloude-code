import { App } from "octokit";
import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from "@octokit/webhooks";
import type { Env } from "@/types";

type WebhookPayload<T extends EmitterWebhookEventName> =
  EmitterWebhookEvent<T>["payload"];

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
      privateKey: atob(env.GITHUB_APP_PRIVATE_KEY),
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
    const numericRepoId = await this.getNumericRepoId(installation.id, owner, repo);
    return this.getInstallationToken(installation.id, { repoName: repo, repoId: numericRepoId });
  }

  /**
   * Resolve a repo's numeric GitHub ID. Checks D1 first, falls back to the API.
   */
  private async getNumericRepoId(installationId: number, owner: string, repo: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT repo_id FROM github_installation_repos
         WHERE installation_id = ? AND repo_name = ?`,
      )
      .bind(installationId, `${owner}/${repo}`)
      .first<{ repo_id: number }>();

    if (row) return row.repo_id;

    // Fallback: query GitHub API
    const octokit = await this.app.getInstallationOctokit(installationId);
    const { data } = await octokit.rest.repos.get({ owner, repo });
    return data.id;
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
        repo
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
    repo?: { repoName: string; repoId: number },
  ): Promise<string> {
    // Check cache (keyed by installation + numeric repo ID to avoid cross-repo token leaks)
    const cacheRepoId = repo?.repoId ?? 0;
    const cached = await this.db
      .prepare(
        `SELECT token, expires_at FROM installation_token_cache
         WHERE installation_id = ? AND repo_id = ?
         AND datetime(expires_at) > datetime('now', '+5 minutes')`,
      )
      .bind(installationId, cacheRepoId)
      .first<{ token: string; expires_at: string }>();

    if (cached) {
      return cached.token;
    }

    // Generate new token via octokit, scoped to single repo with minimum permissions
    const octokit = await this.app.getInstallationOctokit(installationId);
    const { data } = await octokit.rest.apps.createInstallationAccessToken({
      installation_id: installationId,
      ...(repo && { repositories: [repo.repoName] }),
      permissions: {
        contents: "write",
        metadata: "read",
      },
    });

    // Cache it
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO installation_token_cache (installation_id, repo_id, token, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(installationId, cacheRepoId, data.token, data.expires_at)
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
      name: params.name,
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

  private async handleInstallationCreated(
    payload: WebhookPayload<"installation.created">,
  ): Promise<void> {
    const installation = payload.installation;
    const account = installation.account;
    if (!account || !("login" in account)) {
      console.error(`github installation created: ${installation.id} - ${installation.target_type} - no account`);
      return;
    }

    console.log(`github installation created: ${installation.id}\ntarget_type:${installation.target_type}`);
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO github_installations
         (id, app_id, account_id, account_login, account_type, target_type,
          permissions, events, repository_selection, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .bind(
        installation.id,
        installation.app_id,
        account.id,
        account.login,
        account.type,
        installation.target_type,
        JSON.stringify(installation.permissions),
        JSON.stringify(installation.events),
        installation.repository_selection,
      )
      .run();

    // Insert selected repos if any
    if (payload.repositories && payload.repositories.length > 0) {
      console.log(`installation ${installation.id} has ${payload.repositories.length} repositories`);
      const batch = payload.repositories.map((repo) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO github_installation_repos
             (installation_id, repo_id, repo_name)
             VALUES (?, ?, ?)`,
          )
          .bind(installation.id, repo.id, repo.full_name), // full_name is "owner/repo"
      );
      await this.db.batch(batch);
    } else {
      console.log(`installation ${installation.id} has no repositories specified`);
    }
  }

  private async handleInstallationDeleted(
    payload: WebhookPayload<"installation.deleted">,
  ): Promise<void> {
    // CASCADE will clean up repos and token cache
    await this.db
      .prepare(`DELETE FROM github_installations WHERE id = ?`)
      .bind(payload.installation.id)
      .run();
  }

  private async handleInstallationSuspended(
    payload: WebhookPayload<"installation.suspend">,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE github_installations SET suspended_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(payload.installation.id)
      .run();
  }

  private async handleInstallationUnsuspended(
    payload: WebhookPayload<"installation.unsuspend">,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE github_installations SET suspended_at = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(payload.installation.id)
      .run();
  }

  private async handleReposAdded(
    payload: WebhookPayload<"installation_repositories.added">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_added;

    if (repos.length > 0) {
      const batch = repos.map((repo) =>
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

  private async handleReposRemoved(
    payload: WebhookPayload<"installation_repositories.removed">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_removed;

    if (repos.length > 0) {
      const batch = repos.map((repo) =>
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
