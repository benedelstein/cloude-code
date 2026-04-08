import { type Branch, failure, type ListBranchesResponse, type ListReposResponse, type Result, success, type Repo } from "@repo/shared";
import { Octokit } from "octokit";
import { GitHubAppService } from "@/lib/github";
import { createLogger } from "@/lib/logger";
import type { Env } from "@/types";

const logger = createLogger("repos.service.ts");
const DEFAULT_BRANCH_PAGE_SIZE = 10;
const DEFAULT_REPO_PAGE_SIZE = 20;

type RepoPaginationCursor = {
  installationId: number;
  page: number;
};

type ReposServiceStatus = 400;

export interface ReposServiceError {
  domain: "repos";
  status: ReposServiceStatus;
  message: string;
}

type ReposServiceResult<T> = Result<T, ReposServiceError>;

export class ReposService {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Lists repositories visible to the authenticated user via the GitHub App,
   * paginating across both installation order and per-installation repo pages.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @param params.limit - Optional page size.
   * @param params.cursor - Optional pagination cursor.
   * @returns Paginated repositories and install URL on success.
   */
  async listRepos(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
    limit?: number;
    cursor?: string;
  }): Promise<ReposServiceResult<ListReposResponse>> {
    const parsedCursor = parseRepoCursor(params.cursor);
    if (parsedCursor === null) {
      return failure({
        domain: "repos",
        status: 400,
        message: "Invalid repo pagination cursor",
      });
    }

    const octokit = new Octokit({ auth: params.githubAccessToken });
    const github = new GitHubAppService(this.env, logger);
    const limit = params.limit ?? DEFAULT_REPO_PAGE_SIZE;
    const repos: Repo[] = [];
    const cacheWarmEntries: Array<{
      installationId: number;
      repository: {
        id: number;
        fullName: string;
        owner: string;
        name: string;
        defaultBranch: string;
      };
    }> = [];

    const installations = await octokit.paginate(
      octokit.rest.apps.listInstallationsForAuthenticatedUser,
      { per_page: 100 },
    );
    installations.sort((leftInstallation, rightInstallation) => (
      leftInstallation.id - rightInstallation.id
    ));

    if (installations.length === 0) {
      return success({ repos, installUrl: github.getInstallUrl(), cursor: null });
    }

    let installationIndex = 0;
    let startingPage = 1;

    if (parsedCursor.installationId !== 0) {
      installationIndex = installations.findIndex(
        (installation) => installation.id === parsedCursor.installationId,
      );
      if (installationIndex === -1) {
        return failure({
          domain: "repos",
          status: 400,
          message: "Invalid repo pagination cursor",
        });
      }
      startingPage = parsedCursor.page;
    }

    let nextCursor: string | null = null;
    let shouldContinuePaging = true;

    while (
      shouldContinuePaging
      && installationIndex < installations.length
      && repos.length < limit
    ) {
      const installation = installations[installationIndex];
      if (!installation) {
        break;
      }

      let currentPage = installation.id === parsedCursor.installationId
        ? startingPage
        : 1;

      while (repos.length < limit) {
        const remainingSlots = limit - repos.length;
        const response = await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
          installation_id: installation.id,
          per_page: remainingSlots,
          page: currentPage,
        });

        const installationRepositories = response.data.repositories;
        const repositoriesForCache = installationRepositories.map((repo) => ({
          id: repo.id,
          fullName: repo.full_name,
          owner: repo.owner.login,
          name: repo.name,
          defaultBranch: repo.default_branch,
        }));
        cacheWarmEntries.push(
          ...repositoriesForCache.map((repository) => ({
            installationId: installation.id,
            repository,
          })),
        );

        for (const repo of installationRepositories) {
          repos.push({
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            owner: repo.owner.login,
            private: repo.private,
            description: repo.description,
            defaultBranch: repo.default_branch,
          });
        }

        const nextPage = getNextPageCursor(response.headers.link);
        if (nextPage) {
          if (repos.length >= limit) {
            nextCursor = formatRepoCursor({
              installationId: installation.id,
              page: Number.parseInt(nextPage, 10),
            });
            shouldContinuePaging = false;
            break;
          }

          currentPage = Number.parseInt(nextPage, 10);
          continue;
        }

        if (repos.length >= limit && installationIndex < installations.length - 1) {
          const nextInstallation = installations[installationIndex + 1];
          if (!nextInstallation) {
            shouldContinuePaging = false;
            break;
          }

          nextCursor = formatRepoCursor({
            installationId: nextInstallation.id,
            page: 1,
          });
          shouldContinuePaging = false;
          break;
        }

        break;
      }

      installationIndex += 1;
    }

    params.executionCtx.waitUntil(
      github.warmUserAccessibleRepoAccessCache(
        params.userId,
        cacheWarmEntries,
      ).catch((error) => {
        logger.error("Failed to warm GitHub user repo access cache", {
          error,
          fields: {
            userId: params.userId,
          },
        });
      }),
    );

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
   * Lists branches for a repository the user can access.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @param params.repoId - Numeric GitHub repository id.
   * @param params.limit - Optional page size.
   * @param params.cursor - Optional pagination cursor.
   * @returns Paginated branches on success.
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
    const limit = params.limit ?? DEFAULT_BRANCH_PAGE_SIZE;

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

function parseRepoCursor(cursor?: string): RepoPaginationCursor | null {
  if (!cursor) {
    return {
      installationId: 0,
      page: 1,
    };
  }

  const [installationIdText, pageText] = cursor.split(":");
  if (!installationIdText || !pageText) {
    return null;
  }

  const installationId = Number.parseInt(installationIdText, 10);
  const page = Number.parseInt(pageText, 10);
  if (!Number.isInteger(installationId) || installationId < 1) {
    return null;
  }

  if (!Number.isInteger(page) || page < 1) {
    return null;
  }

  return {
    installationId,
    page,
  };
}

function formatRepoCursor(cursor: RepoPaginationCursor): string {
  return `${cursor.installationId}:${cursor.page}`;
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
