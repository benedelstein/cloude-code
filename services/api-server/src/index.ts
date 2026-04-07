import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionsRoutes } from "./routes/sessions/sessions.routes";
import { webhooksRoutes } from "./routes/webhooks.routes";
import { authRoutes } from "./routes/auth/auth.routes";
import { openaiAuthRoutes } from "./routes/auth/openai/openai.routes";
import { claudeAuthRoutes } from "./routes/auth/claude/claude.routes";
import { reposRoutes } from "./routes/repos/repos.routes";
import { attachmentsRoutes } from "./routes/attachments/attachments.routes";
import { agentRoutes } from "./routes/agent.routes";
import { gitProxyRoutes } from "./routes/git-proxy.routes";
import { debugRoutes } from "./routes/debug.routes";
import { modelsRoutes } from "./routes/models.routes";
import type { Env } from "./types";
import { drainAttachmentGcQueue } from "./lib/attachments/attachment-gc-service";
import { initializeLogger } from "./lib/logger";
import { LogLevel } from "@repo/shared";
// import { logger as honoLogger } from "hono/logger";

export { SessionAgentDO } from "./durable-objects/session-agent-do";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  initializeLogger({
    format: c.env.ENVIRONMENT === "production" ? "json" : "pretty",
    level: c.env.LOG_LEVEL as LogLevel,
  });
  await next();
});

// DISABLED FOR NOW - dont log sensitive query params etc.
// app.use(honoLogger()); // logs request timings

app.use(
  "*",
  cors({
    origin: (origin) => origin, // reflect request origin
    credentials: true,
  }),
);

app.get("/", (c) => {
  return c.json({ name: "cloude-code-api", version: "0.0.1", status: "running" });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/agents", agentRoutes);
app.route("/git-proxy", gitProxyRoutes);
app.route("/_debug", debugRoutes);

app.route("/auth", authRoutes);
app.route("/auth", openaiAuthRoutes);
app.route("/auth", claudeAuthRoutes);
app.route("/models", modelsRoutes);

// Protected routes
app.route("/repos", reposRoutes);
app.route("/sessions", sessionsRoutes);
app.route("/attachments", attachmentsRoutes);

app.route("/webhooks", webhooksRoutes);

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(drainAttachmentGcQueue(env));
  },
};
