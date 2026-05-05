import { type Branch, failure, type ListBranchesResponse, type ListReposResponse, type Result, type SearchReposResponse, success, type Repo } from "@repo/shared";
import { Octokit } from "octokit";
import { GitHubAppService, type GitHubRepositoryData } from "@/lib/github";
import {
  GitHubUserRepoAccessCacheRepository,
  listingRowToRepo,
} from "@/repositories/github-user-repo-access-cache-repository";
import { GitHubUserRepoListingSyncRepository } from "@/repositories/github-user-repo-listing-sync-repository";
import { createLogger } from "@/lib/logger";
import type { Env } from "@/types";

const logger = createLogger("repos.service.ts");
const DEFAULT_BRANCH_PAGE_SIZE = 10;
const DEFAULT_REPO_PAGE_SIZE = 20;
const DEFAULT_REPO_SEARCH_LIMIT = 50;
const MAX_REPO_SEARCH_LIMIT = 100;
// How long the full-listing cache stays "fresh" before stale-while-revalidate
// kicks in. Matches USER_REPO_ACCESS_CACHE_TTL_MS in github-app.ts.
const LISTING_FRESHNESS_TTL_MS = 5 * 60 * 1000;
// Per-row expiry for cache entries written by full-sync. Generous so cache
// rows don't expire mid-listing while we're between syncs.
const LISTING_ROW_TTL_MS = 24 * 60 * 60 * 1000;

type ReposServiceStatus = 400;

export interface ReposServiceError {
  domain: "repos";
  status: ReposServiceStatus;
  message: string;
}

type ReposServiceResult<T> = Result<T, ReposServiceError>;

export class ReposService {
  private readonly env: Env;
  private readonly cacheRepository: GitHubUserRepoAccessCacheRepository;
  private readonly listingSyncRepository: GitHubUserRepoListingSyncRepository;

  constructor(env: Env) {
    this.env = env;
    this.cacheRepository = new GitHubUserRepoAccessCacheRepository(env.DB);
    this.listingSyncRepository = new GitHubUserRepoListingSyncRepository(env.DB);
  }

  /**
   * Lists repositories visible to the authenticated user, paginating from the
   * D1 cache populated by `fullSync`. First-ever load awaits a full enumeration
   * inline; subsequent calls return immediately and refresh in the background
   * via `executionCtx.waitUntil` when the cache is stale.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @param params.executionCtx - Worker execution context (used for waitUntil).
   * @param params.limit - Optional page size.
   * @param params.cursor - Optional pagination cursor (last `repo_full_name`
   *   from previous page).
   */
  async listRepos(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
    limit?: number;
    cursor?: string;
  }): Promise<ReposServiceResult<ListReposResponse>> {
    const limit = clampLimit(params.limit, DEFAULT_REPO_PAGE_SIZE);
    const github = new GitHubAppService(this.env, logger);

    const ensured = await this.ensureFreshListing({
      userId: params.userId,
      githubAccessToken: params.githubAccessToken,
      executionCtx: params.executionCtx,
      github,
    });
    if (!ensured.ok) {
      return ensured;
    }

    const rows = await this.cacheRepository.listAllowedByUserPaged(
      params.userId,
      params.cursor ?? null,
      limit,
    );
    const repos = rowsToRepos(rows);
    const nextCursor = rows.length === limit
      ? rows[rows.length - 1]?.repo_full_name ?? null
      : null;

    logger.info(
      `got ${repos.length} repos for user ${params.userId} - limit ${limit} - cursor ${params.cursor ?? "start"} - next cursor ${nextCursor}`,
    );

    return success({
      repos,
      installUrl: github.getInstallUrl(),
      cursor: nextCursor,
    });
  }

  /**
   * Searches the cached listing for repos whose full name (case-insensitive)
   * contains the given query. Same freshness contract as `listRepos`: blocks
   * on the first sync, otherwise serves stale data and refreshes in the
   * background. Returns up to `limit` matches; users narrow further by typing
   * additional characters rather than paginating.
   */
  async searchRepos(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
    query: string;
    limit?: number;
  }): Promise<ReposServiceResult<SearchReposResponse>> {
    const trimmedQuery = params.query.trim();
    if (trimmedQuery.length === 0) {
      return success({ repos: [] });
    }

    const limit = clampLimit(
      params.limit,
      DEFAULT_REPO_SEARCH_LIMIT,
      MAX_REPO_SEARCH_LIMIT,
    );
    const github = new GitHubAppService(this.env, logger);

    const ensured = await this.ensureFreshListing({
      userId: params.userId,
      githubAccessToken: params.githubAccessToken,
      executionCtx: params.executionCtx,
      github,
    });
    if (!ensured.ok) {
      return ensured;
    }

    const rows = await this.cacheRepository.searchAllowedByUser(
      params.userId,
      trimmedQuery,
      limit,
    );
    const repos = rowsToRepos(rows);

    logger.info(
      `repo search for user ${params.userId} - query "${trimmedQuery}" - matches ${repos.length}`,
    );
    return success({ repos });
  }

  /**
   * Lists branches for a repository the user can access.
   */
  async listBranches(params: {
    githubAccessToken: string;
    repoId: number;
    limit?: number;
    cursor?: string;
  }): Promise<ReposServiceResult<ListBranchesResponse>> {
    const page = parseBranchPage(params.cursor);
    if (page === null) {
      return failure({
        domain: "repos",
        status: 400,
        message: "Invalid branch pagination cursor",
      });
    }

    const octokit = new Octokit({ auth: params.githubAccessToken });
    const limit = clampLimit(params.limit, DEFAULT_BRANCH_PAGE_SIZE);

    const { data: repo } = await octokit.request("GET /repositories/{repository_id}", {
      repository_id: params.repoId,
    });

    const response = await octokit.rest.repos.listBranches({
      owner: repo.owner.login,
      repo: repo.name,
      per_page: limit,
      page,
    });
    const branches: Branch[] = response.data.map((branch) => ({
      name: branch.name,
      default: branch.name === repo.default_branch,
    }));
    const nextCursor = getNextPageCursor(response.headers.link);
    logger.info(`got ${branches.length} branches for repo ${repo.name} - limit ${limit} - page ${page} - next cursor ${nextCursor}`);

    return success({
      branches,
      cursor: nextCursor,
    });
  }

  /**
   * Ensure the cached listing is populated and reasonably fresh.
   * - Empty cache (first ever load): await a full sync inline.
   * - Fresh sync_at: no-op.
   * - Stale sync_at: schedule a background refresh via waitUntil; return now.
   */
  private async ensureFreshListing(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
    github: GitHubAppService;
  }): Promise<ReposServiceResult<void>> {
    const syncedAt = await this.listingSyncRepository.getSyncedAt(params.userId);

    if (syncedAt === null) {
      const cachedCount = await this.cacheRepository.countAllowedByUser(params.userId);
      if (cachedCount === 0) {
        // Cold cache: must sync inline before returning anything.
        const result = await this.fullSync({
          userId: params.userId,
          githubAccessToken: params.githubAccessToken,
        });
        if (!result.ok) {
          return result;
        }
        return success(undefined);
      }
      // We have legacy cached rows but no sync marker: serve them and refresh in bg.
      this.scheduleBackgroundFullSync(params);
      return success(undefined);
    }

    const ageMs = Date.now() - new Date(syncedAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > LISTING_FRESHNESS_TTL_MS) {
      this.scheduleBackgroundFullSync(params);
    }
    return success(undefined);
  }

  private scheduleBackgroundFullSync(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
  }): void {
    params.executionCtx.waitUntil(
      this.fullSync({
        userId: params.userId,
        githubAccessToken: params.githubAccessToken,
      }).then((result) => {
        if (!result.ok) {
          logger.error(
            `Background repo listing sync failed for user ${params.userId}: ${result.error.message}`,
          );
        }
      }).catch((error) => {
        logger.error(
          `Background repo listing sync threw for user ${params.userId}`,
          { error },
        );
      }),
    );
  }

  /**
   * Enumerate every installation accessible by the user and every repo within
   * each installation, then atomically replace the user's cached listing and
   * mark `synced_at = now`. This is the only path that populates the listing
   * cache. Internally paginates 100-at-a-time against GitHub.
   */
  private async fullSync(params: {
    userId: string;
    githubAccessToken: string;
  }): Promise<ReposServiceResult<void>> {
    const octokit = new Octokit({ auth: params.githubAccessToken });
    const startedAt = Date.now();

    let installations: Array<{ id: number }>;
    try {
      const allInstallations = await octokit.paginate(
        octokit.rest.apps.listInstallationsForAuthenticatedUser,
        { per_page: 100 },
      );
      installations = allInstallations.map((installation) => ({ id: installation.id }));
    } catch (error) {
      logger.error(
        `Failed to list installations for user ${params.userId}`,
        { error },
      );
      return failure({
        domain: "repos",
        status: 400,
        message: "Failed to list GitHub installations.",
      });
    }

    const entries: Array<{ installationId: number; repository: GitHubRepositoryData }> = [];

    for (const installation of installations) {
      try {
        const repositories = await octokit.paginate(
          octokit.rest.apps.listInstallationReposForAuthenticatedUser,
          {
            installation_id: installation.id,
            per_page: 100,
          },
        );
        for (const repository of repositories) {
          entries.push({
            installationId: installation.id,
            repository: {
              id: repository.id,
              fullName: repository.full_name,
              owner: repository.owner.login,
              name: repository.name,
              defaultBranch: repository.default_branch,
              private: repository.private,
              description: repository.description,
            },
          });
        }
      } catch (error) {
        // A single installation failing shouldn't tank the whole sync;
        // log and continue so other installations still populate.
        logger.error(
          `Failed to list repos for installation ${installation.id} (user ${params.userId})`,
          { error },
        );
      }
    }

    const expiresAt = new Date(Date.now() + LISTING_ROW_TTL_MS).toISOString();
    await this.cacheRepository.replaceAllowedListingForUser(
      params.userId,
      entries,
      expiresAt,
    );
    await this.listingSyncRepository.setSyncedAt(
      params.userId,
      new Date().toISOString(),
    );

    logger.info(
      `full repo sync for user ${params.userId}: ${entries.length} repos across ${installations.length} installations in ${Date.now() - startedAt}ms`,
    );
    return success(undefined);
  }
}

function rowsToRepos(rows: Array<Parameters<typeof listingRowToRepo>[0]>): Repo[] {
  const repos: Repo[] = [];
  for (const row of rows) {
    const repo = listingRowToRepo(row);
    if (repo) {
      repos.push(repo);
    }
  }
  return repos;
}

function clampLimit(
  limit: number | undefined,
  fallback: number,
  max = 100,
): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return fallback;
  }
  return Math.min(limit, max);
}

function parseBranchPage(cursor?: string): number | null {
  if (!cursor) {
    return 1;
  }

  const page = Number.parseInt(cursor, 10);
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }

  return page;
}

function getNextPageCursor(linkHeader?: string): string | null {
  if (!linkHeader) {
    return null;
  }

  for (const segment of linkHeader.split(",")) {
    if (!segment.includes('rel="next"')) {
      continue;
    }

    const nextPageMatch = segment.match(/[?&]page=(\d+)/);
    return nextPageMatch?.[1] ?? null;
  }

  return null;
}
