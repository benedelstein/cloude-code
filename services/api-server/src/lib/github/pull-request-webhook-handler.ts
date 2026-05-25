import type { Logger } from "@repo/shared";
import type { SessionsRepository } from "@/repositories/sessions.repository";
import type { WebhookPayload } from "./github-app.types";
import { mapPullRequestWebhookState } from "./pull-request-webhook";

export async function handlePullRequestWebhook(params: {
  payload: WebhookPayload<"pull_request">;
  sessionsRepository: SessionsRepository;
  logger: Logger;
}): Promise<void> {
  const { payload, sessionsRepository, logger } = params;
  const installationId = "installation" in payload
    ? payload.installation?.id
    : undefined;
  if (!installationId) {
    logger.warn("Pull request webhook missing installation id");
    return;
  }

  const state = mapPullRequestWebhookState(
    payload.action,
    Boolean(payload.pull_request.merged),
  );
  if (!state) {
    logger.debug("Ignoring pull request webhook action", {
      fields: { action: payload.action },
    });
    return;
  }

  await sessionsRepository.updatePullRequestFromWebhook({
    installationId,
    repoId: payload.repository.id,
    number: payload.pull_request.number,
    url: payload.pull_request.html_url,
    state,
  });
}
