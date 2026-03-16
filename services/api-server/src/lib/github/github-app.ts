import { App, Octokit } from "octokit";
import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from "@octokit/webhooks";
import type { Logger } from "@repo/shared";
import { decrypt, encrypt } from "@/lib/crypto";
import type { Env } from "@/types";
import { GitHubInstallationRepository } from "@/repositories/github-installation-repository";
import type {
  GitHubInstallationWithRepo,
  RepositorySelection,
} from "@/repositories/github-installation-repository";
import { GitHubUserRepoAccessCacheRepository } from "@/repositories/github-user-repo-access-cache-repository";
import { InstallationTokenCacheRepository } from "@/repositories/installation-token-cache-repository";
import { UserSessionRepository } from "@/repositories/user-session-repository";

type WebhookPayload<T extends EmitterWebhookEventName> =
  EmitterWebhookEvent<T>["payload"];

const loggerName = "github-app.ts";
const USER_REPO_ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface GithubOAuthUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface GithubOAuthTokenResult {
  accessToken: string;
  refreshToken: string | undefined;
  refreshTokenExpiresAt: string | undefined;
  expiresAt: string | undefined;
  user: GithubOAuthUser;
}

export interface RefreshedToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface GitHubCompareData {
  aheadBy: number;
  totalCommits: number;
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
  commits: Array<{
    sha: string;
    message: string;
    authorName: string | null;
  }>;
}

export interface CreatePullRequestInput {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PullRequestData {
  number: number;
  url: string;
  state: "open" | "closed";
  merged: boolean;
}

export interface GitHubRepositoryData {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  defaultBranch?: string;
}

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
  private readonly app: App;
  private readonly installationRepository: GitHubInstallationRepository;
  private readonly userRepoAccessCacheRepository: GitHubUserRepoAccessCacheRepository;
  private readonly tokenCacheRepository: InstallationTokenCacheRepository;
  private readonly userSessionRepository: UserSessionRepository;
  private readonly clientId: string;
  private readonly appSlug: string;
  private readonly logger: Logger;
  private readonly tokenEncryptionKey: string;

  constructor(env: Env, logger: Logger) {
    this.app = new App({
      appId: env.GITHUB_APP_ID,
      privateKey: atob(env.GITHUB_APP_PRIVATE_KEY),
      webhooks: { secret: env.GITHUB_WEBHOOK_SECRET },
      oauth: {
        clientId: env.GITHUB_APP_CLIENT_ID,
        clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      },
    });
    this.installationRepository = new GitHubInstallationRepository(env.DB);
    this.userRepoAccessCacheRepository = new GitHubUserRepoAccessCacheRepository(env.DB);
    this.tokenCacheRepository = new InstallationTokenCacheRepository(env.DB);
    this.userSessionRepository = new UserSessionRepository(env.DB);
    this.clientId = env.GITHUB_APP_CLIENT_ID;
    this.appSlug = env.GITHUB_APP_SLUG;
    this.logger = logger;
    this.tokenEncryptionKey = env.TOKEN_ENCRYPTION_KEY;
  }

  /**
   * Returns the GitHub OAuth authorization URL.
   * For users who already have the app installed, this goes straight to OAuth.
   * New users will need to install the app separately (or be directed to /installations/new).
   */
  getAuthUrl(state: string): string {
    return `https://github.com/login/oauth/authorize?client_id=${this.clientId}&state=${state}`;
  }

  /**
   * Returns the GitHub App installation URL (for users who need to install the app).
   */
  getInstallUrl(): string {
    return `https://github.com/apps/${this.appSlug}/installations/new`;
  }

  /**
   * Exchange an OAuth authorization code for user tokens + profile info.
   */
  async exchangeOAuthCode(code: string): Promise<GithubOAuthTokenResult> {
    const { authentication } = await this.app.oauth.createToken({ code });

    // Fetch user profile with the new token
    const userOctokit = new Octokit({ auth: authentication.token });
    const { data: ghUser } = await userOctokit.rest.users.getAuthenticated();

    return {
      accessToken: authentication.token,
      refreshToken: authentication.refreshToken,
      refreshTokenExpiresAt: authentication.refreshTokenExpiresAt,
      expiresAt: authentication.expiresAt,
      user: {
        id: ghUser.id,
        login: ghUser.login,
        name: ghUser.name,
        avatarUrl: ghUser.avatar_url,
      },
    };
  }

  /**
   * Refresh an expired user access token using a refresh token.
   */
  async refreshUserToken(refreshToken: string): Promise<RefreshedToken> {
    const { authentication } = await this.app.oauth.refreshToken({
      refreshToken,
    });

    return {
      accessToken: authentication.token,
      refreshToken: authentication.refreshToken,
      expiresAt: authentication.expiresAt,
      refreshTokenExpiresAt: authentication.refreshTokenExpiresAt,
    };
  }

  /**
   * Resolve a repo (owner/name) to an installation access token.
   * Checks D1 for installation, verifies repo access, and returns a cached or fresh token.
   */
  async getInstallationTokenForRepo(repoFullName: string): Promise<string> {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new GitHubAppError("REPO_NOT_ACCESSIBLE", `Invalid repoFullName: ${repoFullName}`);
    }

    const installation = await this.findInstallationForRepo(owner, repo);
    const numericRepoId = await this.getNumericRepoId(installation.id, owner, repo);
    return this.getInstallationToken(installation.id, { repoName: repo, repoId: numericRepoId });
  }

  /**
   * Get a read-only token for a repo, scoped to contents:read only.
   * Used for initial clone where write access is not needed.
   */
  async getReadOnlyTokenForRepo(repoFullName: string): Promise<string> {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new GitHubAppError("REPO_NOT_ACCESSIBLE", `Invalid repoFullName: ${repoFullName}`);
    }

    const installation = await this.findInstallationForRepo(owner, repo);
    const numericRepoId = await this.getNumericRepoId(installation.id, owner, repo);
    return this.getInstallationToken(
      installation.id,
      { repoName: repo, repoId: numericRepoId },
      { contents: "read", metadata: "read" },
    );
  }

  /**
   * Compare two branches using the GitHub App installation token.
   */
  async compareBranches(
    repoFullName: string,
    baseBranch: string,
    headBranch: string,
  ): Promise<GitHubCompareData> {
    const { owner, repo, octokit } = await this.getRepoOctokit(repoFullName);
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseBranch}...${headBranch}`,
    });

    return {
      aheadBy: data.ahead_by,
      totalCommits: data.total_commits,
      files: (data.files ?? []).map((file) => ({
        filename: file.filename,
        status: file.status ?? "modified",
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
      })),
      commits: (data.commits ?? []).map((commit) => ({
        sha: commit.sha,
        message: commit.commit.message ?? "",
        authorName: commit.commit.author?.name ?? null,
      })),
    };
  }

  /**
   * Create a pull request using the GitHub App installation token.
   */
  async createPullRequest(
    repoFullName: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequestData> {
    const { owner, repo, octokit } = await this.getRepoOctokit(repoFullName);
    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
    });

    return {
      number: data.number,
      url: data.html_url,
      state: data.state as "open" | "closed",
      merged: false,
    };
  }

  /**
   * Get pull request status using the GitHub App installation token.
   */
  async getPullRequest(
    repoFullName: string,
    pullRequestNumber: number,
  ): Promise<PullRequestData> {
    const { owner, repo, octokit } = await this.getRepoOctokit(repoFullName);
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullRequestNumber,
    });

    return {
      number: data.number,
      url: data.html_url,
      state: data.state as "open" | "closed",
      merged: data.merged,
    };
  }

  /**
   * Resolve a repo's full name (owner/repo) from its numeric GitHub ID.
   * Checks D1 first, falls back to the GitHub API.
   */
  async getRepoNameById(repoId: number): Promise<string> {
    const installationRepo = await this.installationRepository.findInstallationRepoById(repoId);

    if (installationRepo) return installationRepo.repoName;

    // Fallback: query GitHub API using an app-level request
    const { data } = await this.app.octokit.request("GET /repositories/{id}", {
      id: repoId,
    });
    return data.full_name;
  }

  private buildUserRepoAccessCacheExpiry(): string {
    return new Date(Date.now() + USER_REPO_ACCESS_CACHE_TTL_MS).toISOString();
  }

  /**
   * Resolve a repo's numeric GitHub ID. Checks D1 first, falls back to the API.
   */
  private async getNumericRepoId(installationId: number, owner: string, repo: string): Promise<number> {
    const installationRepo = await this.installationRepository.findRepo(installationId, `${owner}/${repo}`);

    if (installationRepo) return installationRepo.repoId;

    // Fallback: query GitHub API
    const octokit = await this.app.getInstallationOctokit(installationId);
    const { data } = await octokit.rest.repos.get({ owner, repo });
    return data.id;
  }

  private async getRepoOctokit(repoFullName: string): Promise<{
    owner: string;
    repo: string;
    octokit: Octokit;
  }> {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      throw new GitHubAppError("REPO_NOT_ACCESSIBLE", `Invalid repoFullName: ${repoFullName}`);
    }

    const installation = await this.findInstallationForRepo(owner, repo);
    const octokit = await this.app.getInstallationOctokit(installation.id);

    return {
      owner,
      repo,
      octokit,
    };
  }

  private async cacheUserAccessibleInstallationRepos(
    userId: string,
    installationId: number,
    repositories: GitHubRepositoryData[],
  ): Promise<void> {
    await this.userRepoAccessCacheRepository.setAllowedMany(
      userId,
      installationId,
      repositories,
      this.buildUserRepoAccessCacheExpiry(),
    );
  }

  async warmUserAccessibleInstallationReposCache(
    userId: string,
    installationId: number,
    repositories: GitHubRepositoryData[],
  ): Promise<void> {
    await this.cacheUserAccessibleInstallationRepos(
      userId,
      installationId,
      repositories,
    );
  }

  async warmUserAccessibleRepoAccessCache(
    userId: string,
    entries: Array<{
      installationId: number;
      repository: GitHubRepositoryData;
    }>,
  ): Promise<void> {
    await this.userRepoAccessCacheRepository.setAllowedEntries(
      userId,
      entries,
      this.buildUserRepoAccessCacheExpiry(),
    );
  }

  async listUserAccessibleInstallationRepos(
    userId: string,
    userAccessToken: string,
    installationId: number,
  ): Promise<GitHubRepositoryData[]> {
    const userOctokit = new Octokit({ auth: userAccessToken });
    const repositories = await userOctokit.paginate(
      userOctokit.rest.apps.listInstallationReposForAuthenticatedUser,
      {
        installation_id: installationId,
        per_page: 100,
      },
    );
    const repositoryData = repositories.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      owner: repo.owner.login,
      name: repo.name,
      defaultBranch: repo.default_branch,
    }));

    await this.cacheUserAccessibleInstallationRepos(
      userId,
      installationId,
      repositoryData,
    );

    return repositoryData;
  }

  /**
   * Finds a repo accessible by a user id for a given installation id and repo id.
   * @param userId - The user id.
   * @param userAccessToken - The user's access token.
   * @param installationId - The installation id.
   * @param repoId - The repo id.
   * @returns The repository data.
   * 
   * See https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
   */
  async getUserAccessibleInstallationRepoById(
    userId: string,
    userAccessToken: string,
    installationId: number,
    repoId: number,
  ): Promise<GitHubRepositoryData> {
    const cached = await this.userRepoAccessCacheRepository.get(
      userId,
      installationId,
      repoId,
    );
    if (cached) {
      if (!cached.allowed) {
        throw new GitHubAppError(
          "REPO_NOT_ACCESSIBLE",
          `Repository ${repoId} is not accessible to the authenticated user`,
        );
      }

      if (cached.repoFullName) {
        const [owner, name] = cached.repoFullName.split("/");
        if (owner && name) {
        return {
          id: repoId,
          fullName: cached.repoFullName,
          owner,
          name,
        };
        }
      }
    }

    const repositories = await this.listUserAccessibleInstallationRepos(
      userId,
      userAccessToken,
      installationId,
    );
    const matchingRepository = repositories.find((repo) => repo.id === repoId);

    if (!matchingRepository) {
      await this.userRepoAccessCacheRepository.setDenied(
        userId,
        installationId,
        repoId,
        this.buildUserRepoAccessCacheExpiry(),
      );
      throw new GitHubAppError(
        "REPO_NOT_ACCESSIBLE",
        `Repository ${repoId} is not accessible to the authenticated user`,
      );
    }

    return matchingRepository;
  }

  /**
   * Find the GitHub App installation for a given repo by its owner and name.
   * NOTE: Prefer to use findInstallationForRepoId instead. it is more efficient and canonical.
   * First checks D1, then falls back to the GitHub API.
   */
  async findInstallationForRepo(
    owner: string,
    repo: string,
  ): Promise<GitHubInstallationWithRepo> {
    // Check D1 first
    const installation = await this.installationRepository.findByAccountLogin(owner);

    // if access is "selected", the repo should be stored in the db.
    // if access is "all", we need to verify that the repo actually exists via api.
    if (installation && installation.repositorySelection === "selected") {
      const installationRepo = await this.installationRepository.findRepo(
        installation.id,
        `${owner}/${repo}`, // use full name
      );

      if (!installationRepo) {
        throw new GitHubAppError(
          "REPO_NOT_ACCESSIBLE",
          `Repository ${owner}/${repo} is not accessible via the GitHub App installation`,
        );
      }
      return installation;
    }

    this.logger.log(`installation/repo not found in d1 or not scoped to this repo, trying api for ${owner}/${repo}`);

    // Fallback: query GitHub API directly
    try {
      const { data } = await this.app.octokit.rest.apps.getRepoInstallation({
        owner,
        repo,
      });

      return {
        id: data.id,
        repositorySelection: (data.repository_selection ?? "all") as RepositorySelection,
      };
    } catch (_error) {
      this.logger.error(`Failed to get repository installation for ${owner}/${repo}`, {
        loggerName,
        error: _error,
      });
      throw new GitHubAppError(
        "INSTALLATION_NOT_FOUND",
        `No GitHub App installation found for ${owner}/${repo}. Is the app installed on this account?`,
      );
    }
  }

  /**
   * Find the GitHub App installation for a repo using its numeric GitHub ID.
   */
  async findInstallationForRepoId(
    repoId: number,
  ): Promise<GitHubInstallationWithRepo> {
    // first check d1
    const installation = await this.installationRepository.findByRepoId(repoId);

    if (installation) {
      return installation;
    }

    const response = await this.app.octokit.request("GET /repositories/{id}", {
      id: repoId,
    });
    const repoData: Awaited<ReturnType<typeof this.app.octokit.rest.repos.get>>["data"] = response.data;
    const owner = repoData.owner.login;
    const repo = repoData.name;
    const repoFullName = repoData.full_name;

    this.logger.log(`installation/repo not found in d1 or not scoped, trying api for ${repoFullName}`);

    try {
      const { data } = await this.app.octokit.rest.apps.getRepoInstallation({
        owner,
        repo,
      });

      return {
        id: data.id,
        repositorySelection: (data.repository_selection ?? "all") as RepositorySelection,
      };
    } catch (_error) {
      this.logger.error(`Failed to get repository installation for ${repoFullName}`, {
        loggerName,
        error: _error,
      });
      throw new GitHubAppError(
        "INSTALLATION_NOT_FOUND",
        `No GitHub App installation found for ${repoFullName}. Is the app installed on this account?`,
      );
    }
  }

  /**
   * Get an installation access token, using D1 cache with 5-minute buffer.
   * This token allows to make requests as the app on the installation.
   */
  async getInstallationToken(
    installationId: number,
    repo?: { repoName: string; repoId: number },
    permissions: { contents: "read" | "write"; metadata: "read" } = { contents: "write", metadata: "read" },
  ): Promise<string> {
    // Cache key includes installation, repo, and permission scope to avoid cross-token leaks
    const cacheRepoId = repo?.repoId ?? 0;
    const permissionSuffix = permissions.contents === "read" ? ":ro" : "";
    const cacheKey = `${cacheRepoId}${permissionSuffix}`;
    const cached = await this.tokenCacheRepository.get(installationId, cacheKey);

    if (cached) {
      try {
        return await decrypt(cached.token, this.tokenEncryptionKey);
      } catch {
        // Legacy rows may still contain plaintext values from before encryption.
        return cached.token;
      }
    }

    // Generate new token via octokit, scoped to single repo with requested permissions
    const octokit = await this.app.getInstallationOctokit(installationId);
    const { data } = await octokit.rest.apps.createInstallationAccessToken({
      installation_id: installationId,
      ...(repo && { repositories: [repo.repoName] }),
      permissions,
    });

    // Cache it
    const encryptedToken = await encrypt(data.token, this.tokenEncryptionKey);
    await this.tokenCacheRepository.set(installationId, cacheKey, encryptedToken, data.expires_at);

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
    this.logger.info(`github webhook received: ${params.id} - ${params.name}`, {
      loggerName,
    });

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
    // user revoked their oauth tokens.
    this.app.webhooks.on("github_app_authorization.revoked", async ({ payload }) => {
      await this.handleUserAuthorizationRevoked(payload);
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
      this.logger.error(
        `github installation created: ${installation.id} - ${installation.target_type} - no account`,
        { loggerName },
      );
      return;
    }

    this.logger.info(
      `github installation created: ${installation.id}\ntarget_type:${installation.target_type}`,
      { loggerName },
    );
    await this.installationRepository.upsert({
      id: installation.id,
      appId: installation.app_id,
      accountId: account.id,
      accountLogin: account.login,
      accountType: account.type,
      targetType: installation.target_type,
      permissions: JSON.stringify(installation.permissions),
      events: JSON.stringify(installation.events),
      repositorySelection: installation.repository_selection as RepositorySelection,
    });

    // Insert selected repos if any
    if (payload.repositories && payload.repositories.length > 0) {
      this.logger.info(
        `installation ${installation.id} has ${payload.repositories.length} repositories`,
        { loggerName },
      );
      await this.installationRepository.addRepos(
        installation.id,
        payload.repositories.map((repo) => ({ id: repo.id, fullName: repo.full_name })),
      );
    } else {
      this.logger.info(`installation ${installation.id} has no repositories specified`, {
        loggerName,
      });
    }
  }

  private async handleInstallationDeleted(
    payload: WebhookPayload<"installation.deleted">,
  ): Promise<void> {
    this.logger.info(`github installation deleted: ${payload.installation.id}`, {
      loggerName,
    });
    await this.installationRepository.delete(payload.installation.id);
  }

  private async handleInstallationSuspended(
    payload: WebhookPayload<"installation.suspend">,
  ): Promise<void> {
    this.logger.info(`github installation suspended: ${payload.installation.id}`, {
      loggerName,
    });
    await this.installationRepository.setSuspended(payload.installation.id, true);
  }

  private async handleInstallationUnsuspended(
    payload: WebhookPayload<"installation.unsuspend">,
  ): Promise<void> {
    this.logger.info(`github installation unsuspended: ${payload.installation.id}`, {
      loggerName,
    });
    await this.installationRepository.setSuspended(payload.installation.id, false);
  }

  private async handleReposAdded(
    payload: WebhookPayload<"installation_repositories.added">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_added;
    this.logger.info(
      `github installation repositories added: ${installationId} - ${repos.length} repos`,
      {
        loggerName,
      },
    );

    await this.installationRepository.addRepos(
      installationId,
      repos.map((repo) => ({ id: repo.id, fullName: repo.full_name })),
    );
  }

  private async handleUserAuthorizationRevoked(
    payload: WebhookPayload<"github_app_authorization.revoked">,
  ): Promise<void> {
    const githubUserId = payload.sender.id;
    this.logger.info(`github user authorization revoked: ${githubUserId}`, {
      loggerName,
    });
    // Revoke all sessions and the refresh token. The GitHub access token is
    // already invalid, so we must not attempt to use it again.
    await this.userSessionRepository.revokeAllSessionsByGithubId(githubUserId);
  }

  private async handleReposRemoved(
    payload: WebhookPayload<"installation_repositories.removed">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_removed;

    await this.installationRepository.removeRepos(
      installationId,
      repos.map((repo) => repo.id),
    );
  }
}
