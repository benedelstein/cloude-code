import { App, Octokit } from "octokit";
import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from "@octokit/webhooks";
import {
  failure,
  success,
  type Logger,
  type Result,
} from "@repo/shared";
import { decrypt, encrypt } from "@/lib/utils/crypto";
import type { Env } from "@/types";
import { GitHubInstallationRepository } from "@/repositories/github-installation-repository";
import { SessionsRepository } from "@/repositories/sessions.repository";
import type {
  GitHubInstallationWithRepo,
  RepositorySelection,
} from "@/repositories/github-installation-repository";
import { GitHubUserRepoAccessCacheRepository } from "@/repositories/github-user-repo-access-cache-repository";
import { InstallationTokenCacheRepository } from "@/repositories/installation-token-cache-repository";
import { UserSessionRepository } from "@/repositories/user-session-repository";
import { requestSessionAccessBlockedCleanup } from "@/lib/session-access-block";

type WebhookPayload<T extends EmitterWebhookEventName> =
  EmitterWebhookEvent<T>["payload"];

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
  | "INVALID_REPO"
  | "GITHUB_API_ERROR";

export type GitHubAppServiceError = {
  code: GitHubAppErrorCode;
  message: string;
  status?: number;
  details?: string;
};

export type GitHubAppResult<T> = Result<T, GitHubAppServiceError>;

export class GitHubAppService {
  private readonly app: App;
  private readonly env: Env;
  private readonly installationRepository: GitHubInstallationRepository;
  private readonly sessionsRepository: SessionsRepository;
  private readonly userRepoAccessCacheRepository: GitHubUserRepoAccessCacheRepository;
  private readonly tokenCacheRepository: InstallationTokenCacheRepository;
  private readonly userSessionRepository: UserSessionRepository;
  private readonly clientId: string;
  private readonly appSlug: string;
  private readonly logger: Logger;
  private readonly tokenEncryptionKey: string;

  constructor(env: Env, logger: Logger) {
    this.env = env;
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
    this.sessionsRepository = new SessionsRepository(env.DB);
    this.userRepoAccessCacheRepository = new GitHubUserRepoAccessCacheRepository(env.DB);
    this.tokenCacheRepository = new InstallationTokenCacheRepository(env.DB);
    this.userSessionRepository = new UserSessionRepository(env.DB);
    this.clientId = env.GITHUB_APP_CLIENT_ID;
    this.appSlug = env.GITHUB_APP_SLUG;
    this.logger = logger.scope("github-app.ts");
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
  async getInstallationTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>> {
    const repoParts = this.parseRepoFullName(repoFullName);
    if (!repoParts.ok) {
      return repoParts;
    }

    const { owner, repo } = repoParts.value;
    const installationResult = await this.findInstallationForRepo(owner, repo);
    if (!installationResult.ok) {
      return installationResult;
    }

    try {
      const numericRepoId = await this.getNumericRepoId(
        installationResult.value.id,
        owner,
        repo,
      );
      const token = await this.getInstallationToken(
        installationResult.value.id,
        { repoName: repo, repoId: numericRepoId },
      );
      return success(token);
    } catch (error) {
      return this.githubApiFailure(
        `Failed to resolve installation token for ${repoFullName}.`,
        error,
      );
    }
  }

  /**
   * Get a read-only token for a repo, scoped to contents:read only.
   * Used for initial clone where write access is not needed.
   */
  async getReadOnlyTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>> {
    const repoParts = this.parseRepoFullName(repoFullName);
    if (!repoParts.ok) {
      return repoParts;
    }

    const { owner, repo } = repoParts.value;
    const installationResult = await this.findInstallationForRepo(owner, repo);
    if (!installationResult.ok) {
      return installationResult;
    }

    try {
      const numericRepoId = await this.getNumericRepoId(
        installationResult.value.id,
        owner,
        repo,
      );
      const token = await this.getInstallationToken(
        installationResult.value.id,
        { repoName: repo, repoId: numericRepoId },
        { contents: "read", metadata: "read" },
      );
      return success(token);
    } catch (error) {
      return this.githubApiFailure(
        `Failed to resolve read-only installation token for ${repoFullName}.`,
        error,
      );
    }
  }

  /**
   * Compare two branches using the GitHub App installation token.
   */
  async compareBranches(
    repoFullName: string,
    baseBranch: string,
    headBranch: string,
  ): Promise<GitHubAppResult<GitHubCompareData>> {
    const repoOctokitResult = await this.getRepoOctokit(repoFullName);
    if (!repoOctokitResult.ok) {
      return repoOctokitResult;
    }

    const { owner, repo, octokit } = repoOctokitResult.value;

    try {
      const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${baseBranch}...${headBranch}`,
      });

      return success({
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
      });
    } catch (error) {
      return this.githubApiFailure(
        `Failed to compare branches for ${repoFullName}.`,
        error,
      );
    }
  }

  /**
   * Create a pull request using the GitHub App installation token.
   */
  async createPullRequest(
    repoFullName: string,
    input: CreatePullRequestInput,
  ): Promise<GitHubAppResult<PullRequestData>> {
    const repoOctokitResult = await this.getRepoOctokit(repoFullName);
    if (!repoOctokitResult.ok) {
      return repoOctokitResult;
    }

    const { owner, repo, octokit } = repoOctokitResult.value;

    try {
      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      });

      return success({
        number: data.number,
        url: data.html_url,
        state: data.state as "open" | "closed",
        merged: false,
      });
    } catch (error) {
      return this.githubApiFailure(
        `Failed to create pull request for ${repoFullName}.`,
        error,
      );
    }
  }

  /**
   * Get pull request status using the GitHub App installation token.
   */
  async getPullRequest(
    repoFullName: string,
    pullRequestNumber: number,
  ): Promise<GitHubAppResult<PullRequestData>> {
    const repoOctokitResult = await this.getRepoOctokit(repoFullName);
    if (!repoOctokitResult.ok) {
      return repoOctokitResult;
    }

    const { owner, repo, octokit } = repoOctokitResult.value;

    try {
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullRequestNumber,
      });

      return success({
        number: data.number,
        url: data.html_url,
        state: data.state as "open" | "closed",
        merged: data.merged,
      });
    } catch (error) {
      return this.githubApiFailure(
        `Failed to fetch pull request ${pullRequestNumber} for ${repoFullName}.`,
        error,
      );
    }
  }

  /**
   * Resolve a repo's full name (owner/repo) from its numeric GitHub ID.
   * Checks D1 first, falls back to the GitHub API.
   */
  async getRepoNameById(repoId: number, userAccessToken: string): Promise<string> {
    const installationRepo = await this.installationRepository.findInstallationRepoById(repoId);

    if (installationRepo) return installationRepo.repoName;

    // Fallback: query GitHub API using an app-level request
    const octokit = new Octokit({ auth: userAccessToken });
    const { data } = await octokit.request("GET /repositories/{id}", {
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

  private async getRepoOctokit(repoFullName: string): Promise<GitHubAppResult<{
    owner: string;
    repo: string;
    octokit: Octokit;
  }>> {
    const repoParts = this.parseRepoFullName(repoFullName);
    if (!repoParts.ok) {
      return repoParts;
    }

    const { owner, repo } = repoParts.value;
    const installationResult = await this.findInstallationForRepo(owner, repo);
    if (!installationResult.ok) {
      return installationResult;
    }

    try {
      const octokit = await this.app.getInstallationOctokit(installationResult.value.id);
      return success({
        owner,
        repo,
        octokit,
      });
    } catch (error) {
      return this.githubApiFailure(
        `Failed to create installation client for ${repoFullName}.`,
        error,
      );
    }
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
   * @param repoId - The repo id to look up.
   * @returns The repository data.
   * 
   * See https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
   */
  async getUserAccessibleInstallationRepoById(
    userId: string,
    userAccessToken: string,
    installationId: number,
    repoId: number,
  ): Promise<GitHubAppResult<GitHubRepositoryData>> {
    const cached = await this.userRepoAccessCacheRepository.get(
      userId,
      installationId,
      repoId,
    );
    if (cached) {
      if (!cached.allowed) {
        return failure({
          code: "REPO_NOT_ACCESSIBLE",
          message: `Repository ${repoId} is not accessible to the authenticated user`,
        });
      }

      if (cached.repoFullName) {
        const [owner, name] = cached.repoFullName.split("/");
        if (owner && name) {
          return success({
            id: repoId,
            fullName: cached.repoFullName,
            owner,
            name,
          });
        }
      }
    }

    // NOTE: this is slow, but its the only way to authoritatively know if a repo 
    //is accessible for an installation by a user. stupid.
    let repositories: GitHubRepositoryData[];
    try {
      repositories = await this.listUserAccessibleInstallationRepos(
        userId,
        userAccessToken,
        installationId,
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 404
      ) {
        return failure({
          code: "INSTALLATION_NOT_FOUND",
          message: `No GitHub App installation found for installation ${installationId}.`,
        });
      }

      return this.githubApiFailure(
        `Failed to list accessible repositories for installation ${installationId}.`,
        error,
      );
    }

    const matchingRepository = repositories.find((repo) => repo.id === repoId);

    if (!matchingRepository) {
      await this.userRepoAccessCacheRepository.setDenied(
        userId,
        installationId,
        repoId,
        this.buildUserRepoAccessCacheExpiry(),
      );
      return failure({
        code: "REPO_NOT_ACCESSIBLE",
        message: `Repository ${repoId} is not accessible to the authenticated user`,
      });
    }

    return success(matchingRepository);
  }

  /**
   * Find the GitHub App installation for a given repo by its owner and name.
   * NOTE: Prefer to use findInstallationForRepoId instead. it is more efficient and canonical.
   * First checks D1, then falls back to the GitHub API.
   */
  private async findInstallationForRepo(
    owner: string,
    repo: string,
  ): Promise<GitHubAppResult<GitHubInstallationWithRepo>> {
    const d1 = new Date();
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
        return failure({
          code: "REPO_NOT_ACCESSIBLE",
          message: `Repository ${owner}/${repo} is not accessible via the GitHub App installation`,
        });
      }
      this.logger.log(`found installation for ${owner}/${repo} in d1 in ${new Date().getTime() - d1.getTime()}ms`);
      return success(installation);
    }

    this.logger.log(`installation/repo not found in d1 or not scoped to this repo, trying api for ${owner}/${repo}`);

    // Fallback: query GitHub API directly
    try {
      const { data } = await this.app.octokit.rest.apps.getRepoInstallation({
        owner,
        repo,
      });

      this.logger.log(`found installation for ${owner}/${repo} in api in ${new Date().getTime() - d1.getTime()}ms`);
      return success({
        id: data.id,
        repositorySelection: (data.repository_selection ?? "all") as RepositorySelection,
      });
    } catch (error) {
      this.logger.error(`Failed to get repository installation for ${owner}/${repo}`, {
        error,
      });

      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 404
      ) {
        return failure({
          code: "INSTALLATION_NOT_FOUND",
          message: `No GitHub App installation found for ${owner}/${repo}. Is the app installed on this account?`,
        });
      }

      return this.githubApiFailure(
        `Failed to get repository installation for ${owner}/${repo}.`,
        error,
      );
    }
  }

  /**
   * Find the GitHub App installation for a repo using its numeric GitHub ID.
   */
  async findInstallationForRepoId(
    repoId: number,
    userAccessToken: string,
  ): Promise<GitHubAppResult<GitHubInstallationWithRepo>> {
    // first check d1
    const installation = await this.installationRepository.findByRepoId(repoId);

    if (installation) {
      return success(installation);
    }

    try {
      const userOctokit = new Octokit({ auth: userAccessToken });
      const response = await userOctokit.request("GET /repositories/{repository_id}", {
        repository_id: repoId,
      });
      const repoData = response.data;
      const owner = repoData.owner.login;
      const repo = repoData.name;
      const repoFullName = repoData.full_name;

      this.logger.log(`installation/repo not found in d1 or not scoped, trying api for ${repoFullName}`);
      return this.findInstallationForRepo(owner, repo);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 404
      ) {
        this.logger.warn(`Received 404 from github api for repo ${repoId}`);
        return failure({
          code: "REPO_NOT_ACCESSIBLE",
          message: `Repository ${repoId} is not accessible to the authenticated user.`,
        });
      }

      return this.githubApiFailure(
        `Failed to resolve repository ${repoId} from GitHub.`,
        error,
      );
    }
  }

  private parseRepoFullName(repoFullName: string): GitHubAppResult<{
    owner: string;
    repo: string;
  }> {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      return failure({
        code: "INVALID_REPO",
        message: `Invalid repoFullName: ${repoFullName}`,
      });
    }

    return success({ owner, repo });
  }

  private githubApiFailure<T>(
    message: string,
    error: unknown,
  ): GitHubAppResult<T> {
    this.logger.error(message, { error });
    const errorStatus = (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
    )
      ? error.status
      : undefined;
    const errorDetails = (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
    )
      ? error.message
      : undefined;
    return failure({
      code: "GITHUB_API_ERROR",
      message,
      status: errorStatus,
      details: errorDetails,
    });
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
    this.logger.info(`github webhook received: ${params.id} - ${params.name}`);

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
      );
      return;
    }

    this.logger.info(
      `github installation created: ${installation.id}\ntarget_type:${installation.target_type}`,
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
      );
      await this.installationRepository.addRepos(
        installation.id,
        payload.repositories.map((repo) => ({ id: repo.id, fullName: repo.full_name })),
      );
    } else {
      this.logger.info(`installation ${installation.id} has no repositories specified`);
    }
  }

  private async handleInstallationDeleted(
    payload: WebhookPayload<"installation.deleted">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    this.logger.info(`github installation deleted: ${installationId}`);
    await this.userRepoAccessCacheRepository.deleteByInstallationId(installationId);
    await this.installationRepository.delete(installationId);
    const sessionIds = await this.sessionsRepository.blockSessionsForDeletedInstallation(
      installationId,
    );
    await this.requestAccessBlockedCleanup(sessionIds);
  }

  private async handleInstallationSuspended(
    payload: WebhookPayload<"installation.suspend">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    this.logger.info(`github installation suspended: ${installationId}`);
    await this.installationRepository.setSuspended(installationId, true);
    await this.userRepoAccessCacheRepository.deleteByInstallationId(installationId);
    const sessionIds = await this.sessionsRepository.blockSessionsForSuspendedInstallation(
      installationId,
    );
    await this.requestAccessBlockedCleanup(sessionIds);
  }

  private async handleInstallationUnsuspended(
    payload: WebhookPayload<"installation.unsuspend">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    this.logger.info(`github installation unsuspended: ${installationId}`);
    await this.installationRepository.setSuspended(installationId, false);
    await this.userRepoAccessCacheRepository.deleteByInstallationId(installationId);
  }

  private async handleReposAdded(
    payload: WebhookPayload<"installation_repositories.added">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_added;
    const repositorySelection = payload.installation.repository_selection as RepositorySelection;
    const repoIds = repos.map((repo) => repo.id);
    const reposToAdd = repos.map((repo) => ({ id: repo.id, fullName: repo.full_name }));
    const existingInstallation = await this.installationRepository.findById(installationId);
    const previousRepositorySelection = existingInstallation?.repositorySelection ?? null;

    this.logger.info(
      `github installation repositories added: ${installationId} - ${repos.length} repos. ${previousRepositorySelection} -> ${repositorySelection}`,
    );

    await this.installationRepository.setRepositorySelectionAndAddRepos(
      installationId,
      repositorySelection,
      reposToAdd,
    );
    // if we transition to all, it will include all current repositories in the webhook data.
    // if we transition from all -> allowed, it only triggers repositories.added webhook with the new subset.
    // so we need to clear the old repos from installation_repos

    // nOTE: Don't upsert cache rows to `allowed = true`; a repo being added to the installation does not
    // guarantee the authenticated user can access it. Instead, invalidate any
    // stale cache rows that GitHub's repository-selection transition may have changed.
    if (previousRepositorySelection === "all" && repositorySelection === "selected") {
      await this.installationRepository.deleteByInstallationIdExceptRepoIds(
        installationId,
        repoIds,
      );
      await this.userRepoAccessCacheRepository.deleteByInstallationIdExceptRepoIds(
        installationId,
        repoIds,
      );
    } else if (previousRepositorySelection === "selected" && repositorySelection === "all") {
      await this.userRepoAccessCacheRepository.deleteByInstallationId(installationId);
    } else if (previousRepositorySelection === null || (previousRepositorySelection == repositorySelection)) {
      await this.userRepoAccessCacheRepository.deleteByInstallationIdAndRepoIds(
        installationId,
        repoIds,
      );
    }
  }

  private async handleUserAuthorizationRevoked(
    payload: WebhookPayload<"github_app_authorization.revoked">,
  ): Promise<void> {
    const githubUserId = payload.sender.id;
    this.logger.info(`github user authorization revoked: ${githubUserId}`);
    // Revoke all sessions and the refresh token. The GitHub access token is
    // already invalid, so we must not attempt to use it again.
    await this.userSessionRepository.revokeAllSessionsByGithubId(githubUserId);
  }

  private async handleReposRemoved(
    payload: WebhookPayload<"installation_repositories.removed">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_removed;
    const repoIds = repos.map((repo) => repo.id);

    await this.installationRepository.removeRepos(
      installationId,
      repoIds,
    );
    await this.userRepoAccessCacheRepository.deleteByInstallationIdAndRepoIds(
      installationId,
      repoIds,
    );
    const sessionIds = await this.sessionsRepository.blockSessionsForRemovedRepos(
      installationId,
      repoIds,
    );
    await this.requestAccessBlockedCleanup(sessionIds);
  }

  private async requestAccessBlockedCleanup(sessionIds: string[]): Promise<void> {
    await Promise.allSettled(
      sessionIds.map((sessionId) =>
        requestSessionAccessBlockedCleanup(this.env, sessionId),
      ),
    );
  }
}
