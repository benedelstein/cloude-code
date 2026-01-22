import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionsRoutes } from "./routes/sessions.routes";
import { testRoutes } from "./routes/test.routes";
import type { Env } from "./types";

export { SessionAgentDO } from "./durable-objects/session-agent-do";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({ name: "cloude-code-api", version: "0.0.1" });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/sessions", sessionsRoutes);
app.route("/test", testRoutes);

export default app;
