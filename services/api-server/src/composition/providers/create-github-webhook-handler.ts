import { App } from "octokit";
import type { Logger } from "@repo/shared";
import { GitHubWebhookInstallationService } from "@/modules/github/services/github-webhook-installation.service";
import { GitHubWebhookService } from "@/modules/webhooks/services/github-webhook.service";
import type {
  GitHubWebhookInstallationProvider,
} from "@/modules/webhooks/providers/github-webhook.providers";
import type { Env } from "@/shared/types";
import { createGitHubWebhookSessionProvider } from "./create-github-webhook-session-provider";

export function createGithubWebhookService(params: {
  env: Env;
  logger: Logger;
}): GitHubWebhookService {
  const installationProvider: GitHubWebhookInstallationProvider =
    new GitHubWebhookInstallationService(params.env.DB);

  return new GitHubWebhookService({
    app: new App({
      appId: params.env.GITHUB_APP_ID,
      privateKey: atob(params.env.GITHUB_APP_PRIVATE_KEY),
      webhooks: { secret: params.env.GITHUB_WEBHOOK_SECRET },
      oauth: {
        clientId: params.env.GITHUB_APP_CLIENT_ID,
        clientSecret: params.env.GITHUB_APP_CLIENT_SECRET,
      },
    }),
    installationProvider,
    sessionProvider: createGitHubWebhookSessionProvider(params.env),
    logger: params.logger,
  });
}
