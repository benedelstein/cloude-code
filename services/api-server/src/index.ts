import { Hono } from "hono";
import { cors } from "hono/cors";
import { sessionsRoutes } from "./routes/sessions.routes";
import type { Env } from "./types";

export { SessionAgent } from "./durable-objects/session-agent";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({ name: "cloude-code-api", version: "0.0.1" });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/sessions", sessionsRoutes);

export default app;
