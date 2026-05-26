import type { Logger } from "@repo/shared";
import type { App } from "octokit";
import type { WebhookPayload } from "@/shared/types/github";
import type {
  GitHubWebhookHandlerFactoryDeps,
  GitHubWebhookInstallationProvider,
  GitHubWebhookRepositorySelection,
  GitHubWebhookSessionProvider,
} from "../providers/github-webhook.providers";
import { mapPullRequestWebhookState } from "./pull-request-webhook.service";

export class GitHubWebhookHandlers {
  private readonly app: App;
  private readonly installationProvider: GitHubWebhookInstallationProvider;
  private readonly sessionProvider: GitHubWebhookSessionProvider;
  private readonly logger: Logger;
  private registered = false;

  constructor(params: GitHubWebhookHandlerFactoryDeps) {
    this.app = params.app;
    this.installationProvider = params.installationProvider;
    this.sessionProvider = params.sessionProvider;
    this.logger = params.logger.scope("github-webhook-handlers.ts");
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
      await this.handlePullRequestWebhook(payload);
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
    await this.installationProvider.upsertInstallation({
      id: installation.id,
      appId: installation.app_id,
      accountId: account.id,
      accountLogin: account.login,
      accountType: account.type,
      targetType: installation.target_type,
      permissions: JSON.stringify(installation.permissions),
      events: JSON.stringify(installation.events),
      repositorySelection: installation.repository_selection as GitHubWebhookRepositorySelection,
    });

    if (payload.repositories && payload.repositories.length > 0) {
      this.logger.info("Installation has repositories", {
        fields: {
          installationId: installation.id,
          repositoryCount: payload.repositories.length,
        },
      });
      await this.installationProvider.addInstallationRepos(
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
    await this.installationProvider.clearRepoListingSyncForInstallation(installationId);
    await this.installationProvider.clearRepoAccessCacheForInstallation(installationId);
    await this.installationProvider.deleteInstallation(installationId);
    const sessionIds = await this.sessionProvider.blockSessionsForDeletedInstallation(
      installationId,
    );
    await this.sessionProvider.requestAccessBlockedCleanup(sessionIds);
  }

  private async handleInstallationSuspended(
    payload: WebhookPayload<"installation.suspend">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    this.logger.info("GitHub installation suspended", {
      fields: { installationId },
    });
    await this.installationProvider.setInstallationSuspended(installationId, true);
    await this.installationProvider.clearRepoListingSyncForInstallation(installationId);
    await this.installationProvider.clearRepoAccessCacheForInstallation(installationId);
    const sessionIds = await this.sessionProvider.blockSessionsForSuspendedInstallation(
      installationId,
    );
    await this.sessionProvider.requestAccessBlockedCleanup(sessionIds);
  }

  private async handleInstallationUnsuspended(
    payload: WebhookPayload<"installation.unsuspend">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    this.logger.info("GitHub installation unsuspended", {
      fields: { installationId },
    });
    await this.installationProvider.setInstallationSuspended(installationId, false);
    await this.installationProvider.clearRepoListingSyncForInstallation(installationId);
    await this.installationProvider.clearRepoAccessCacheForInstallation(installationId);
  }

  private async handleReposAdded(
    payload: WebhookPayload<"installation_repositories.added">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_added;
    const repositorySelection =
      payload.installation.repository_selection as GitHubWebhookRepositorySelection;
    const repoIds = repos.map((repo) => repo.id);
    const reposToAdd = repos.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
    }));
    const existingInstallation =
      await this.installationProvider.findInstallation(installationId);
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

    await this.installationProvider.setRepositorySelectionAndAddRepos(
      installationId,
      repositorySelection,
      reposToAdd,
    );

    await this.installationProvider.clearRepoListingSyncForInstallation(installationId);
    if (previousRepositorySelection === "all" && repositorySelection === "selected") {
      await this.installationProvider.deleteInstallationReposExceptRepoIds(
        installationId,
        repoIds,
      );
      await this.installationProvider.clearRepoAccessCacheForInstallationExceptRepoIds(
        installationId,
        repoIds,
      );
    } else if (previousRepositorySelection === "selected" && repositorySelection === "all") {
      await this.installationProvider.clearRepoAccessCacheForInstallation(installationId);
    } else if (previousRepositorySelection === null || previousRepositorySelection === repositorySelection) {
      await this.installationProvider.clearRepoAccessCacheForInstallationRepoIds(
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
    await this.sessionProvider.revokeUserSessionsByGithubId(githubUserId);
  }

  private async handleReposRemoved(
    payload: WebhookPayload<"installation_repositories.removed">,
  ): Promise<void> {
    const installationId = payload.installation.id;
    const repos = payload.repositories_removed;
    const repoIds = repos.map((repo) => repo.id);

    await this.installationProvider.removeInstallationRepos(installationId, repoIds);
    await this.installationProvider.clearRepoListingSyncForInstallation(installationId);
    await this.installationProvider.clearRepoAccessCacheForInstallationRepoIds(
      installationId,
      repoIds,
    );
    const sessionIds = await this.sessionProvider.blockSessionsForRemovedRepos({
      installationId,
      repoIds,
    });
    await this.sessionProvider.requestAccessBlockedCleanup(sessionIds);
  }

  private async handlePullRequestWebhook(
    payload: WebhookPayload<"pull_request">,
  ): Promise<void> {
    const installationId = "installation" in payload
      ? payload.installation?.id
      : undefined;
    if (!installationId) {
      this.logger.warn("Pull request webhook missing installation id");
      return;
    }

    const state = mapPullRequestWebhookState(
      payload.action,
      Boolean(payload.pull_request.merged),
    );
    if (!state) {
      this.logger.debug("Ignoring pull request webhook action", {
        fields: { action: payload.action },
      });
      return;
    }

    await this.sessionProvider.updatePullRequestFromWebhook({
      installationId,
      repoId: payload.repository.id,
      number: payload.pull_request.number,
      url: payload.pull_request.html_url,
      state,
    });
  }
}
