import type { App } from "octokit";
import type { Logger } from "@repo/shared";
import type { Env } from "@/types";
import {
  GitHubInstallationRepository,
  type RepositorySelection,
} from "@/repositories/github-installation-repository";
import { GitHubUserRepoAccessCacheRepository } from "@/repositories/github-user-repo-access-cache-repository";
import { GitHubUserRepoListingSyncRepository } from "@/repositories/github-user-repo-listing-sync-repository";
import { SessionsRepository } from "@/repositories/sessions.repository";
import { UserSessionRepository } from "@/repositories/user-session-repository";
import { requestSessionAccessBlockedCleanup } from "@/lib/sessions/session-access-block";
import type { WebhookPayload } from "./github-app.types";
import { handlePullRequestWebhook } from "./pull-request-webhook-handler";

export class GitHubWebhookHandlers {
  private readonly app: App;
  private readonly env: Env;
  private readonly logger: Logger;
  private readonly installationRepository: GitHubInstallationRepository;
  private readonly sessionsRepository: SessionsRepository;
  private readonly userRepoAccessCacheRepository: GitHubUserRepoAccessCacheRepository;
  private readonly userRepoListingSyncRepository: GitHubUserRepoListingSyncRepository;
  private readonly userSessionRepository: UserSessionRepository;
  private registered = false;

  constructor(params: {
    app: App;
    env: Env;
    logger: Logger;
  }) {
    this.app = params.app;
    this.env = params.env;
    this.logger = params.logger.scope("github-webhook-handlers.ts");
    this.installationRepository = new GitHubInstallationRepository(params.env.DB);
    this.sessionsRepository = new SessionsRepository(params.env.DB);
    this.userRepoAccessCacheRepository =
      new GitHubUserRepoAccessCacheRepository(params.env.DB);
    this.userRepoListingSyncRepository =
      new GitHubUserRepoListingSyncRepository(params.env.DB);
    this.userSessionRepository = new UserSessionRepository(params.env.DB);
  }

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
    this.logger.info("GitHub webhook received", {
      fields: { id: params.id, name: params.name },
    });

    await this.app.webhooks.verifyAndReceive({
      id: params.id,
      name: params.name,
      signature: params.signature,
      payload: params.payload,
    });
  }

  private registerWebhookHandlers(): void {
    if (this.registered) { return; }
    this.registered = true;

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

    this.app.webhooks.on("pull_request", async ({ payload }) => {
      await handlePullRequestWebhook({
        payload,
        sessionsRepository: this.sessionsRepository,
        logger: this.logger,
      });
    });
  }

  private async handleInstallationCreated(
    payload: WebhookPayload<"installation.created">,
  ): Promise<void> {
    const installation = payload.installation;
    const account = installation.account;
    if (!account || !("login" in account)) {
      this.logger.error("GitHub installation created without account", {
        fields: {
          installationId: installation.id,
          targetType: installation.target_type,
        },
      });
      return;
    }

    this.logger.info("GitHub installation created", {
      fields: {
        installationId: installation.id,
        targetType: installation.target_type,
      },
    });
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

    if (payload.repositories && payload.repositories.length > 0) {
      this.logger.info("Installation has repositories", {
        fields: {
          installationId: installation.id,
          repositoryCount: payload.repositories.length,
        },
      });
      await this.installationRepository.addRepos(
        installation.id,
        payload.repositories.map((repo) => ({
          id: repo.id,
          fullName: repo.full_name,
        })),
      );
    } else {
      this.logger.info("Installation has no repositories specified", {
        fields: { installationId: installation.id },
      });
    }
  }

  private async handleInstallationDeleted(
    payload: WebhookPayload<"installation.deleted">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    this.logger.info("GitHub installation deleted", { fields: { installationId } });
    // Clear listing-sync markers before access-cache rows are deleted, so the
    // sub-select can still find affected users.
    await this.userRepoListingSyncRepository.clearForInstallation(installationId);
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
    this.logger.info("GitHub installation suspended", {
      fields: { installationId },
    });
    await this.installationRepository.setSuspended(installationId, true);
    await this.userRepoListingSyncRepository.clearForInstallation(installationId);
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
    this.logger.info("GitHub installation unsuspended", {
      fields: { installationId },
    });
    await this.installationRepository.setSuspended(installationId, false);
    await this.userRepoListingSyncRepository.clearForInstallation(installationId);
    await this.userRepoAccessCacheRepository.deleteByInstallationId(installationId);
  }

  private async handleReposAdded(
    payload: WebhookPayload<"installation_repositories.added">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_added;
    const repositorySelection =
      payload.installation.repository_selection as RepositorySelection;
    const repoIds = repos.map((repo) => repo.id);
    const reposToAdd = repos.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
    }));
    const existingInstallation =
      await this.installationRepository.findById(installationId);
    const previousRepositorySelection =
      existingInstallation?.repositorySelection ?? null;

    this.logger.info("GitHub installation repositories added", {
      fields: {
        installationId,
        repositoryCount: repos.length,
        previousRepositorySelection,
        repositorySelection,
      },
    });

    await this.installationRepository.setRepositorySelectionAndAddRepos(
      installationId,
      repositorySelection,
      reposToAdd,
    );

    // Repo selection transitions can make existing cache rows stale. Do not
    // mark added repos as allowed here; the authenticated user may still lack access.
    await this.userRepoListingSyncRepository.clearForInstallation(installationId);
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
    } else if (previousRepositorySelection === null || previousRepositorySelection === repositorySelection) {
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
    this.logger.info("GitHub user authorization revoked", {
      fields: { githubUserId },
    });
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

    await this.installationRepository.removeRepos(installationId, repoIds);
    await this.userRepoListingSyncRepository.clearForInstallation(installationId);
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
