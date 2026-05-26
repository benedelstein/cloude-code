import {
  GitHubInstallationRepository,
  type GitHubInstallationRepoInput,
  type RepositorySelection,
  type UpsertInstallationInput,
} from "../repositories/github-installation-repository";
import { GitHubUserRepoAccessCacheRepository } from "../repositories/github-user-repo-access-cache-repository";
import { GitHubUserRepoListingSyncRepository } from "../repositories/github-user-repo-listing-sync-repository";

export class GitHubWebhookInstallationService {
  private readonly installations: GitHubInstallationRepository;
  private readonly accessCache: GitHubUserRepoAccessCacheRepository;
  private readonly listingSync: GitHubUserRepoListingSyncRepository;

  constructor(database: D1Database) {
    this.installations = new GitHubInstallationRepository(database);
    this.accessCache = new GitHubUserRepoAccessCacheRepository(database);
    this.listingSync = new GitHubUserRepoListingSyncRepository(database);
  }

  async findInstallation(installationId: number): Promise<{
    repositorySelection: RepositorySelection;
  } | null> {
    const installation = await this.installations.findById(installationId);
    if (!installation) {
      return null;
    }
    return { repositorySelection: installation.repositorySelection };
  }

  upsertInstallation(input: UpsertInstallationInput): Promise<void> {
    return this.installations.upsert(input);
  }

  addInstallationRepos(
    installationId: number,
    repos: GitHubInstallationRepoInput[],
  ): Promise<void> {
    return this.installations.addRepos(installationId, repos);
  }

  deleteInstallation(installationId: number): Promise<void> {
    return this.installations.delete(installationId);
  }

  setInstallationSuspended(
    installationId: number,
    suspended: boolean,
  ): Promise<void> {
    return this.installations.setSuspended(installationId, suspended);
  }

  setRepositorySelectionAndAddRepos(
    installationId: number,
    repositorySelection: RepositorySelection,
    repos: GitHubInstallationRepoInput[],
  ): Promise<void> {
    return this.installations.setRepositorySelectionAndAddRepos(
      installationId,
      repositorySelection,
      repos,
    );
  }

  deleteInstallationReposExceptRepoIds(
    installationId: number,
    repoIds: number[],
  ): Promise<void> {
    return this.installations.deleteByInstallationIdExceptRepoIds(
      installationId,
      repoIds,
    );
  }

  removeInstallationRepos(
    installationId: number,
    repoIds: number[],
  ): Promise<void> {
    return this.installations.removeRepos(installationId, repoIds);
  }

  clearRepoAccessCacheForInstallation(installationId: number): Promise<void> {
    return this.accessCache.deleteByInstallationId(installationId);
  }

  clearRepoAccessCacheForInstallationRepoIds(
    installationId: number,
    repoIds: number[],
  ): Promise<void> {
    return this.accessCache.deleteByInstallationIdAndRepoIds(
      installationId,
      repoIds,
    );
  }

  clearRepoAccessCacheForInstallationExceptRepoIds(
    installationId: number,
    repoIds: number[],
  ): Promise<void> {
    return this.accessCache.deleteByInstallationIdExceptRepoIds(
      installationId,
      repoIds,
    );
  }

  clearRepoListingSyncForInstallation(installationId: number): Promise<void> {
    return this.listingSync.clearForInstallation(installationId);
  }
}
