import type {
  CreateSessionRequest,
  CreateSessionResponse,
  DiscordLinkClaimResponse,
  DiscordSessionRequest,
  Repo,
  Result,
} from "@repo/shared";

export interface DiscordAuthenticatedRequest {
  discordUserId: string;
  discordUsername?: string;
  prompt: string;
  guildId?: string;
  channelId?: string;
}

export interface DiscordRepoRoutingCandidate extends Repo {
  readmeExcerpt?: string;
  score: number;
}

export interface DiscordRepoResolution {
  repo: DiscordRepoRoutingCandidate;
  reason?: string;
}

export interface DiscordRepoCandidateProviderError {
  status: 400 | 503;
  message: string;
}

export interface DiscordRepoCandidateProvider {
  listAccessibleRepos(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
    limit: number;
  }): Promise<Result<Repo[], DiscordRepoCandidateProviderError>>;
  getReadmeExcerpt(params: {
    githubAccessToken: string;
    repo: Repo;
    maxChars: number;
  }): Promise<string | null>;
}

export interface DiscordGitHubTokenProvider {
  getValidGitHubAccessTokenByUserId(userId: string): Promise<string | null>;
}

export interface DiscordSessionCreatorError {
  status: number;
  message: string;
  code?: string;
}

export interface DiscordSessionCreator {
  createSession(params: {
    userId: string;
    githubAccessToken: string;
    request: CreateSessionRequest;
  }): Promise<Result<CreateSessionResponse, DiscordSessionCreatorError>>;
}

export interface DiscordSessionRequestDeps {
  tokenProvider: DiscordGitHubTokenProvider;
  repoCandidateProvider: DiscordRepoCandidateProvider;
  sessionCreator: DiscordSessionCreator;
}


export interface DiscordLinkClaimerError {
  status: 400;
  message: string;
}

export interface DiscordLinkClaimer {
  claimDiscordLink(params: {
    token: string;
    userId: string;
  }): Promise<Result<DiscordLinkClaimResponse, DiscordLinkClaimerError>>;
}

export type DiscordSessionRequestPayload = DiscordSessionRequest;
