import { Hono } from "hono";
import { cors } from "hono/cors";
import type { LogLevel } from "@repo/shared";
import {
  buildAgentRoutes,
  buildAttachmentsRoutes,
  buildAuthRoutes,
  buildGitProxyRoutes,
  buildInternalRoutes,
  buildModelsRoutes,
  buildRepoScopedEnvironmentRoutes,
  buildReposRoutes,
  buildSessionsRoutes,
  buildUserEnvironmentRoutes,
  buildWebhooksRoutes,
} from "@/composition/build-routes";
import { SessionAgentDO } from "@/runtime/session-agent.do";
import { UserSessionsDO } from "@/runtime/user-sessions.do";
import { handleScheduled } from "@/composition/scheduled";
import type { Env } from "@/shared/types";
import { initializeLogger } from "@/shared/logging";
// import { requestLoggerMiddleware } from "@/shared/middleware/request-logger.middleware";

export { SessionAgentDO, UserSessionsDO };

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
// TODO: Consider moving this under /sessions/:sessionId/git-proxy and rolling
// it into the sessions route tree. Keep existing active session remotes in mind.
app.route("/git-proxy", buildGitProxyRoutes());
app.route("/internal", buildInternalRoutes());

app.route("/auth", buildAuthRoutes());
app.route("/models", buildModelsRoutes());

// Protected routes
app.route("/repos", buildReposRoutes());
app.route("/repos", buildRepoScopedEnvironmentRoutes());
app.route("/sessions", buildSessionsRoutes());
app.route("/attachments", buildAttachmentsRoutes());
app.route("/environments", buildUserEnvironmentRoutes());

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
