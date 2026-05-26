import type {
  AgentSettings,
  ClientState,
  Logger,
  PullRequestState,
  SessionWorkingState,
} from "@repo/shared";
import type { Env } from "@/shared/types";
import type { GitHubAppResult } from "@/shared/types/github";
import type { SessionRepoAccessResult } from "@/shared/types/repo-access";
import type { ProviderCredentialAdapter } from "./services/sprite-agent-process-manager.service";
import type { ProviderConnectionStatus } from "./services/session-provider-connection.service";

export interface SessionSummaryRepository {
  updateWorkingState(
    sessionId: string,
    workingState: SessionWorkingState,
  ): Promise<void>;
  updatePushedBranch(sessionId: string, pushedBranch: string): Promise<void>;
  setPullRequest(
    sessionId: string,
    data: { url: string; number: number; state: PullRequestState },
  ): Promise<void>;
  updatePullRequestState(
    sessionId: string,
    state: PullRequestState,
  ): Promise<void>;
}

export interface SessionAgentGitHubProvider {
  getReadOnlyTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>>;
  getInstallationTokenForRepo(repoFullName: string): Promise<GitHubAppResult<string>>;
}

export interface SessionAgentRuntime {
  createSessionSummaryRepository(env: Env): SessionSummaryRepository;
  createGitHubProvider(env: Env, logger: Logger): SessionAgentGitHubProvider;
  assertSessionRepoAccess(input: {
    env: Env;
    sessionId: string;
    userId: string;
  }): Promise<SessionRepoAccessResult>;
  getProviderConnectionStatus(
    provider: ClientState["agentSettings"]["provider"],
    userId: string,
    env: Env,
    logger: Logger,
  ): Promise<ProviderConnectionStatus>;
  getProviderCredentialAdapter(
    provider: AgentSettings["provider"],
    env: Env,
    logger: Logger,
  ): ProviderCredentialAdapter;
}

function missingRuntime(): never {
  throw new Error("SessionAgent runtime dependencies have not been configured.");
}

let runtime: SessionAgentRuntime = {
  createSessionSummaryRepository: missingRuntime,
  createGitHubProvider: missingRuntime,
  assertSessionRepoAccess: missingRuntime,
  getProviderConnectionStatus: missingRuntime,
  getProviderCredentialAdapter: missingRuntime,
};

export function configureSessionAgentRuntime(deps: SessionAgentRuntime): void {
  runtime = deps;
}

export function getSessionAgentRuntime(): SessionAgentRuntime {
  return runtime;
}
