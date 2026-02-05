import { Hono } from "hono";
import { cors } from "hono/cors";
import { getAgentByName } from "agents";
import { sessionsRoutes } from "./routes/sessions.routes";
import { testRoutes } from "./routes/test.routes";
import type { Env } from "./types";
import type { SessionAgentDO } from "./durable-objects/session-agent-do";

export { SessionAgentDO } from "./durable-objects/session-agent-do";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

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

app.route("/sessions", sessionsRoutes);
app.route("/test", testRoutes);

export default app;
