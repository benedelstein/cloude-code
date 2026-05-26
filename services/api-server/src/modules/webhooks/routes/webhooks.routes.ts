import { Hono } from "hono";
import type { Logger } from "@repo/shared";
import type { GitHubWebhookService } from "../services/github-webhook.service";
import { createLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";

export interface WebhooksRouteDeps {
  createGithubWebhookService(params: {
    env: Env;
    logger: Logger;
  }): GitHubWebhookService;
}

export function createWebhooksRoutes(deps: WebhooksRouteDeps): Hono<{ Bindings: Env }> {
  const routes = new Hono<{ Bindings: Env }>();
  const logger = createLogger("webhooks.routes.ts");

  routes.post("/github", async (c) => {
    const id = c.req.header("x-github-delivery");
    const name = c.req.header("x-github-event");
    const signature = c.req.header("x-hub-signature-256");

    if (!id || !name || !signature) {
      return c.json({ error: "Missing required GitHub webhook headers" }, 400);
    }

    const webhookHandlers = deps.createGithubWebhookService({
      env: c.env,
      logger,
    });

    try {
      await webhookHandlers.handleWebhook({
        id,
        name,
        signature,
        payload: await c.req.text(),
      });
      return c.json({ ok: true });
    } catch (error) {
      logger.error("Webhook processing failed", { error });
      return c.json({ error: "Webhook processing failed" }, 500);
    }
  });

  return routes;
}
