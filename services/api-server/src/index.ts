import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAgentByName } from "agents";
import { sessionsRoutes } from "./routes/sessions.routes";
import { testRoutes } from "./routes/test.routes";
import { webhooksRoutes } from "./routes/webhooks.routes";
import { authRoutes } from "./routes/auth.routes";
import { reposRoutes } from "./routes/repos.routes";
import { authMiddleware } from "./middleware/auth.middleware";
import type { Env } from "./types";
import type { SessionAgentDO } from "./durable-objects/session-agent-do";

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
  return c.json({ name: "cloude-code-api", version: "0.0.1" });
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
  return stub.fetch(new Request(`http://do${url.pathname}${url.search}`, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  }));
});

app.route("/auth", authRoutes);
app.route("/repos", reposRoutes);

// Protected routes
app.use("/sessions/*", authMiddleware);
app.route("/sessions", sessionsRoutes);

app.route("/test", testRoutes);
app.route("/webhooks", webhooksRoutes);

export default app;
