import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAgentByName } from "agents";
import { sessionsRoutes } from "./routes/sessions/sessions.routes";
import { testRoutes } from "./routes/test.routes";
import { webhooksRoutes } from "./routes/webhooks.routes";
import { authRoutes } from "./routes/auth/auth.routes";
import { reposRoutes } from "./routes/repos/repos.routes";
import { authMiddleware, validateAuthToken } from "./middleware/auth.middleware";
import { SessionHistoryService } from "./lib/session-history";
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
  return c.json({ name: "cloude-code-api", version: "0.0.1", status: "running" });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// Agent WebSocket route (for useAgent hook)
// Browsers cannot send Authorization headers on WebSocket upgrades, so we
// accept the token as a ?token= query parameter and verify session ownership.
app.all("/agents/session/:sessionId", async (c) => {
  console.log("Agent WebSocket route", c.req.url);

  // Extract token from query param (WebSocket) or Authorization header (HTTP)
  const url = new URL(c.req.url);
  const queryToken = url.searchParams.get("token");
  const authHeader = c.req.header("Authorization");
  const token = queryToken ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const user = await validateAuthToken(token, c.env);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const sessionId = c.req.param("sessionId");

  // Verify the user owns this session
  const sessionHistory = new SessionHistoryService(c.env.DB);
  const owned = await sessionHistory.isOwnedBy(sessionId, user.id);
  if (!owned) {
    return c.json({ error: "Forbidden" }, 403);
  }

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
app.route("/repos", reposRoutes);

// Protected routes
app.use("/sessions/*", authMiddleware);
app.route("/sessions", sessionsRoutes);

app.use("/test/*", authMiddleware);
app.route("/test", testRoutes);
app.route("/webhooks", webhooksRoutes);

export default app;
