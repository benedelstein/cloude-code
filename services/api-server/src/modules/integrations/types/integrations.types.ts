import type {
  CreateSessionRequest,
  CreateSessionResponse,
  IntegrationProvider,
  Repo,
  Result,
} from "@repo/shared";

export interface IntegrationRepoRoutingCandidate extends Repo {
  readmeExcerpt?: string;
  score: number;
}

export interface IntegrationRepoResolution {
  repo: IntegrationRepoRoutingCandidate;
  reason?: string;
}

export interface IntegrationRepoCandidateProviderError {
  status: 400 | 503;
  message: string;
}

export interface IntegrationRepoCandidateProvider {
  listAccessibleRepos(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
    limit: number;
  }): Promise<Result<Repo[], IntegrationRepoCandidateProviderError>>;
  getReadme(params: {
    githubAccessToken: string;
    repo: Repo;
  }): Promise<string | null>;
}

export interface IntegrationGitHubTokenProvider {
  getValidGitHubAccessTokenByUserId(userId: string): Promise<string | null>;
}

export interface IntegrationSessionCreatorError {
  status: number;
  message: string;
  code?: string;
}

export interface IntegrationSessionCreator {
  createSession(params: {
    userId: string;
    githubAccessToken: string;
    request: CreateSessionRequest;
    source: IntegrationProvider;
  }): Promise<Result<CreateSessionResponse, IntegrationSessionCreatorError>>;
}

export interface IntegrationSessionRequestDeps {
  tokenProvider: IntegrationGitHubTokenProvider;
  repoCandidateProvider: IntegrationRepoCandidateProvider;
  sessionCreator: IntegrationSessionCreator;
}

export interface IntegrationLinkClaimerError {
  status: 400;
  message: string;
}
