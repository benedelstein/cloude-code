import { Hono } from "hono";
import { GitHubAppService } from "@/lib/github";
import type { Env } from "@/types";

export const webhooksRoutes = new Hono<{ Bindings: Env }>();

webhooksRoutes.post("/github", async (c) => {
  const id = c.req.header("x-github-delivery");
  const name = c.req.header("x-github-event");
  const signature = c.req.header("x-hub-signature-256");

  if (!id || !name || !signature) {
    return c.json({ error: "Missing required GitHub webhook headers" }, 400);
  }

  const github = new GitHubAppService(c.env);

  try {
    await github.handleWebhook({
      id,
      name,
      signature,
      payload: await c.req.text(),
    });
    return c.json({ ok: true });
  } catch (error) {
    console.error("Webhook processing failed:", error);
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});
