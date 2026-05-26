import { Hono } from "hono";
import { cors } from "hono/cors";
import type { LogLevel } from "@repo/shared";
import {
  buildAgentRoutes,
  buildAttachmentsRoutes,
  buildAuthRoutes,
  buildClaudeAuthRoutes,
  buildDebugRoutes,
  buildGitProxyRoutes,
  buildInternalRoutes,
  buildModelsRoutes,
  buildOpenAIAuthRoutes,
  buildReposRoutes,
  buildSessionsRoutes,
  buildWebhooksRoutes,
} from "@/composition/build-routes";
import { SessionAgentDO } from "@/composition/session-agent";
import { handleScheduled } from "@/composition/scheduled";
import type { Env } from "@/shared/types";
import { initializeLogger } from "@/shared/logging";
// import { requestLoggerMiddleware } from "@/shared/middleware/request-logger.middleware";

export { SessionAgentDO };

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  initializeLogger({
    format: c.env.ENVIRONMENT === "production" ? "json" : "pretty",
    level: c.env.LOG_LEVEL as LogLevel,
  });
  await next();
});

// app.use("*", requestLoggerMiddleware); // instead of default cf logger

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

app.route("/agents", buildAgentRoutes());
app.route("/git-proxy", buildGitProxyRoutes());
app.route("/internal", buildInternalRoutes());
app.route("/_debug", buildDebugRoutes());

app.route("/auth", buildAuthRoutes());
app.route("/auth", buildOpenAIAuthRoutes()); // TODO: can these go inside auth routes?
app.route("/auth", buildClaudeAuthRoutes());
app.route("/models", buildModelsRoutes());

// Protected routes
app.route("/repos", buildReposRoutes());
app.route("/sessions", buildSessionsRoutes());
app.route("/attachments", buildAttachmentsRoutes());

app.route("/webhooks", buildWebhooksRoutes());

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    handleScheduled(env, ctx);
  },
};
