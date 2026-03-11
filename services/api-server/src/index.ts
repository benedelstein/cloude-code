import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAgentByName } from "agents";
import { sessionsRoutes } from "./routes/sessions/sessions.routes";
import { testRoutes } from "./routes/test.routes";
import { webhooksRoutes } from "./routes/webhooks.routes";
import { authRoutes } from "./routes/auth/auth.routes";
import { openaiAuthRoutes } from "./routes/auth/openai.routes";
import { claudeAuthRoutes } from "./routes/auth/claude/claude.routes";
import { reposRoutes } from "./routes/repos/repos.routes";
import { attachmentsRoutes } from "./routes/attachments/attachments.routes";
import { authMiddleware } from "./middleware/auth.middleware";
import type { Env } from "./types";
import type { SessionAgentDO } from "./durable-objects/session-agent-do";
import { AttachmentService } from "./lib/attachments/attachment-service";

export { SessionAgentDO } from "./durable-objects/session-agent-do";

const app = new Hono<{ Bindings: Env }>();
const ATTACHMENT_GC_BATCH_SIZE = 100;
const ATTACHMENT_GC_MAX_RETRIES = 20;

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

// Agent WebSocket route (for useAgent hook)
app.all("/agents/session/:sessionId", async (c) => {
  console.log("Agent WebSocket route", c.req.url);
  const sessionId = c.req.param("sessionId");
  const stub = await getAgentByName<Env, SessionAgentDO>(c.env.SESSION_AGENT, sessionId);
  return stub.fetch(c.req.raw);
});

// Git proxy: forward to the session's DO for authenticated git operations
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
app.route("/repos", reposRoutes);

// Protected routes
app.use("/sessions/*", authMiddleware);
app.route("/sessions", sessionsRoutes);
app.use("/attachments", authMiddleware);
app.use("/attachments/*", authMiddleware);
app.route("/attachments", attachmentsRoutes);

app.route("/test", testRoutes);
app.route("/webhooks", webhooksRoutes);

async function drainAttachmentGcQueue(env: Env): Promise<void> {
  const attachmentService = new AttachmentService(env.DB);
  const tasks = await attachmentService.listGcTasks(
    ATTACHMENT_GC_BATCH_SIZE,
    ATTACHMENT_GC_MAX_RETRIES,
  );
  for (const task of tasks) {
    try {
      await env.ATTACHMENTS_BUCKET.delete(task.objectKey);
      await attachmentService.markGcTaskDone(task.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await attachmentService.markGcTaskFailed(task.id, errorMessage);
    }
  }
}

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
