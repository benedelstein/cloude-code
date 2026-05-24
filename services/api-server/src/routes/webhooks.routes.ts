import { Hono } from "hono";
import { GitHubProvider } from "@/lib/providers/github-provider";
import { createLogger } from "@/lib/providers/observability-provider";
import type { Env } from "@/types";

export const webhooksRoutes = new Hono<{ Bindings: Env }>();
const logger = createLogger("webhooks.routes.ts");

webhooksRoutes.post("/github", async (c) => {
  const id = c.req.header("x-github-delivery");
  const name = c.req.header("x-github-event");
  const signature = c.req.header("x-hub-signature-256");

  if (!id || !name || !signature) {
    return c.json({ error: "Missing required GitHub webhook headers" }, 400);
  }

  const githubService = new GitHubProvider(c.env, logger);

  try {
    await githubService.handleWebhook({
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
