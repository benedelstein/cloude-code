import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from "@octokit/webhooks";
import type { Result } from "@repo/shared";

export type WebhookPayload<T extends EmitterWebhookEventName> =
  EmitterWebhookEvent<T>["payload"];

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
  private?: boolean;
  description?: string | null;
}

export type GitHubAppErrorCode =
  | "INSTALLATION_NOT_FOUND"
  | "REPO_NOT_ACCESSIBLE"
  | "INVALID_REPO"
  | "GITHUB_API_ERROR"
  | "GITHUB_AUTH_ERROR";

export type GitHubAppServiceError = {
  code: GitHubAppErrorCode;
  message: string;
  details?: string;
};

export type GitHubAppResult<T> = Result<T, GitHubAppServiceError>;
