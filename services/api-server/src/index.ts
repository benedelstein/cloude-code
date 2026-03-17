import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAgentByName } from "agents";
import { sessionsRoutes } from "./routes/sessions/sessions.routes";
import { webhooksRoutes } from "./routes/webhooks.routes";
import { authRoutes } from "./routes/auth/auth.routes";
import { openaiAuthRoutes } from "./routes/auth/openai.routes";
import { claudeAuthRoutes } from "./routes/auth/claude/claude.routes";
import { reposRoutes } from "./routes/repos/repos.routes";
import { attachmentsRoutes } from "./routes/attachments/attachments.routes";
import type { Env } from "./types";
import type { SessionAgentDO } from "./durable-objects/session-agent-do";
import { drainAttachmentGcQueue } from "./lib/attachments/attachment-gc-service";
import { SessionHistoryService } from "./lib/session-history";
import { verifySessionWebSocketToken } from "./lib/session-websocket-token";
import { logger } from "./lib/logger";

export { SessionAgentDO } from "./durable-objects/session-agent-do";

const app = new Hono<{ Bindings: Env }>();

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

app.all("/agents/session/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const requestUrl = new URL(c.req.url);
  const token = requestUrl.searchParams.get("token");

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const tokenPayload = await verifySessionWebSocketToken(
    c.env.WEBSOCKET_TOKEN_SIGNING_KEY,
    token,
  );

  if (!tokenPayload || tokenPayload.sessionId !== sessionId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const sessionHistory = new SessionHistoryService(c.env.DB);
  const isOwnedByUser = await sessionHistory.isOwnedByUser(
    sessionId,
    tokenPayload.userId,
  );
  logger.log(`${sessionId} isOwnedByUser?: ${isOwnedByUser}`);

  if (!isOwnedByUser) {
    return c.json({ error: "Session not found" }, 404);
  }

  requestUrl.searchParams.delete("token"); // sanitize token, no longer needed
  const stub = await getAgentByName<Env, SessionAgentDO>(c.env.SESSION_AGENT, sessionId);
  const doRequest = new Request(`http://do${requestUrl.pathname}${requestUrl.search}`, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  });
  return stub.fetch(doRequest);
});

// Git proxy: forward to the session's DO for authenticated git operations
// the DO handles authentication internally via a shared secret.
app.all("/git-proxy/:sessionId/*", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getAgentByName<Env, SessionAgentDO>(c.env.SESSION_AGENT, sessionId);
  const url = new URL(c.req.url);
  const doRequest = new Request(`http://do${url.pathname}${url.search}`, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  });
  const response = await stub.fetch(doRequest);
  return response;
});

app.route("/auth", authRoutes);
app.route("/auth", openaiAuthRoutes);
app.route("/auth", claudeAuthRoutes);

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
