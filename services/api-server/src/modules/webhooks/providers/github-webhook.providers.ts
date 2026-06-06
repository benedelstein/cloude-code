import type { Logger, PullRequestState } from "@repo/shared";
import type { App } from "octokit";

export type GitHubWebhookRepositorySelection = "all" | "selected";

export interface GitHubWebhookRepoInput {
  id: number;
  fullName: string;
}

export interface GitHubWebhookInstallationInput {
  id: number;
  appId: number;
  accountId: number;
  accountLogin: string;
  accountType: string;
  targetType: string;
  permissions: string;
  events: string;
  repositorySelection: GitHubWebhookRepositorySelection;
}

export interface GitHubWebhookInstallationProvider {
  findInstallation(installationId: number): Promise<{
    repositorySelection: GitHubWebhookRepositorySelection;
  } | null>;
  upsertInstallation(input: GitHubWebhookInstallationInput): Promise<void>;
  addInstallationRepos(
    installationId: number,
    repos: GitHubWebhookRepoInput[],
  ): Promise<void>;
  deleteInstallation(installationId: number): Promise<void>;
  setInstallationSuspended(
    installationId: number,
    suspended: boolean,
  ): Promise<void>;
  setRepositorySelectionAndAddRepos(
    installationId: number,
    repositorySelection: GitHubWebhookRepositorySelection,
    repos: GitHubWebhookRepoInput[],
  ): Promise<void>;
  deleteInstallationReposExceptRepoIds(
    installationId: number,
    repoIds: number[],
  ): Promise<void>;
  removeInstallationRepos(
    installationId: number,
    repoIds: number[],
  ): Promise<void>;
  clearRepoAccessCacheForInstallation(installationId: number): Promise<void>;
  clearRepoAccessCacheForInstallationRepoIds(
    installationId: number,
    repoIds: number[],
  ): Promise<void>;
  clearRepoAccessCacheForInstallationExceptRepoIds(
    installationId: number,
    repoIds: number[],
  ): Promise<void>;
  clearRepoListingSyncForInstallation(installationId: number): Promise<void>;
}

export interface GitHubWebhookSessionProvider {
  blockSessionsForDeletedInstallation(installationId: number): Promise<string[]>;
  blockSessionsForSuspendedInstallation(installationId: number): Promise<string[]>;
  blockSessionsForRemovedRepos(input: {
    installationId: number;
    repoIds: number[];
  }): Promise<string[]>;
  requestAccessBlockedCleanup(sessionIds: string[]): Promise<void>;
  revokeUserSessionsByGithubId(githubId: number): Promise<void>;
  updatePullRequestFromWebhook(input: {
    installationId: number;
    repoId: number;
    number: number;
    state: PullRequestState;
  }): Promise<void>;
}

export interface GitHubWebhookHandlerFactoryDeps {
  app: App;
  installationProvider: GitHubWebhookInstallationProvider;
  sessionProvider: GitHubWebhookSessionProvider;
  logger: Logger;
}
