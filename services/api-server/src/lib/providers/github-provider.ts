import { Octokit } from "octokit";
import type { Logger } from "@repo/shared";
import { GitHubAppService } from "@/lib/github/github-app";
import type {
  CreatePullRequestInput,
  GitHubAppResult,
  GitHubCompareData,
  GitHubRepositoryData,
  GithubOAuthTokenResult,
  PullRequestData,
  RefreshedToken,
} from "@/lib/github/github-app";
import type { Env } from "@/types";

export type {
  GitHubAppErrorCode,
  GitHubAppResult,
  GitHubCompareData,
  GitHubRepositoryData,
  GithubOAuthTokenResult,
  GithubOAuthUser,
  PullRequestData,
  RefreshedToken,
} from "@/lib/github/github-app";

export interface GitHubInstallationSummary {
  id: number;
}

export interface GitHubBranchSummary {
  name: string;
  default: boolean;
}

export interface GitHubBranchList {
  repoName: string;
  branches: GitHubBranchSummary[];
  nextCursor: string | null;
}

export class GitHubProvider {
  private readonly appService: GitHubAppService;

  constructor(env: Env, logger: Logger) {
    this.appService = new GitHubAppService(env, logger);
  }

  getAuthUrl(state: string): string {
    return this.appService.getAuthUrl(state);
  }

  getInstallUrl(): string {
    return this.appService.getInstallUrl();
  }

  exchangeOAuthCode(code: string): Promise<GithubOAuthTokenResult> {
    return this.appService.exchangeOAuthCode(code);
  }

  refreshUserToken(refreshToken: string): Promise<RefreshedToken> {
    return this.appService.refreshUserToken(refreshToken);
  }

  hasInstallations(accessToken: string): Promise<boolean> {
    const octokit = new Octokit({ auth: accessToken });
    return octokit.request("GET /user/installations", { per_page: 1 })
      .then(({ data }) => data.total_count > 0);
  }

  getInstallationTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>> {
    return this.appService.getInstallationTokenForRepo(repoFullName);
  }

  getReadOnlyTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>> {
    return this.appService.getReadOnlyTokenForRepo(repoFullName);
  }

  compareBranches(
    repoFullName: string,
    baseBranch: string,
    headBranch: string,
  ): Promise<GitHubAppResult<GitHubCompareData>> {
    return this.appService.compareBranches(repoFullName, baseBranch, headBranch);
  }

  createPullRequest(
    repoFullName: string,
    input: CreatePullRequestInput,
  ): Promise<GitHubAppResult<PullRequestData>> {
    return this.appService.createPullRequest(repoFullName, input);
  }

  getPullRequest(
    repoFullName: string,
    pullRequestNumber: number,
  ): Promise<GitHubAppResult<PullRequestData>> {
    return this.appService.getPullRequest(repoFullName, pullRequestNumber);
  }

  getUserAccessibleInstallationRepoById(
    userId: string,
    userAccessToken: string,
    installationId: number,
    repoId: number,
  ): Promise<GitHubAppResult<GitHubRepositoryData>> {
    return this.appService.getUserAccessibleInstallationRepoById(
      userId,
      userAccessToken,
      installationId,
      repoId,
    );
  }

  findInstallationForRepoId(
    repoId: number,
    userAccessToken: string,
  ): ReturnType<GitHubAppService["findInstallationForRepoId"]> {
    return this.appService.findInstallationForRepoId(repoId, userAccessToken);
  }

  handleWebhook(params: Parameters<GitHubAppService["handleWebhook"]>[0]): Promise<void> {
    return this.appService.handleWebhook(params);
  }

  async listInstallationsForAuthenticatedUser(
    accessToken: string,
  ): Promise<GitHubInstallationSummary[]> {
    const octokit = new Octokit({ auth: accessToken });
    const installations = await octokit.paginate(
      octokit.rest.apps.listInstallationsForAuthenticatedUser,
      { per_page: 100 },
    );
    return installations.map((installation) => ({ id: installation.id }));
  }

  async listInstallationReposForAuthenticatedUser(params: {
    accessToken: string;
    installationId: number;
  }): Promise<GitHubRepositoryData[]> {
    const octokit = new Octokit({ auth: params.accessToken });
    const repositories = await octokit.paginate(
      octokit.rest.apps.listInstallationReposForAuthenticatedUser,
      {
        installation_id: params.installationId,
        per_page: 100,
      },
    );
    return repositories.map((repository) => ({
      id: repository.id,
      fullName: repository.full_name,
      owner: repository.owner.login,
      name: repository.name,
      defaultBranch: repository.default_branch,
      private: repository.private,
      description: repository.description,
    }));
  }

  async listBranchesForRepo(params: {
    accessToken: string;
    repoId: number;
    limit: number;
    page: number;
  }): Promise<GitHubBranchList> {
    const octokit = new Octokit({ auth: params.accessToken });
    const { data: repo } = await octokit.request("GET /repositories/{repository_id}", {
      repository_id: params.repoId,
    });
    const response = await octokit.rest.repos.listBranches({
      owner: repo.owner.login,
      repo: repo.name,
      per_page: params.limit,
      page: params.page,
    });

    return {
      repoName: repo.name,
      branches: response.data.map((branch) => ({
        name: branch.name,
        default: branch.name === repo.default_branch,
      })),
      nextCursor: getNextPageCursor(response.headers.link),
    };
  }
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
