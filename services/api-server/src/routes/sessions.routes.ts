import { Context, Hono } from "hono";
import { CreateSessionRequest } from "@repo/shared";
import type { Env } from "../types";

export const sessionsRoutes = new Hono<{ Bindings: Env }>();

const getSessionAgent = (id: string, c: Context<{ Bindings: Env }>) => {
  const doId = c.env.SESSION_AGENT.idFromName(id);
  return c.env.SESSION_AGENT.get(doId, { 
    // locationHint: "wnam", // todo: maybe make this close to the user? and make the sprite close to it too.
  });
};

// Create a new session
sessionsRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateSessionRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const sessionId = crypto.randomUUID();
  const stub = getSessionAgent(sessionId, c);

  // Initialize the session in the DO
  const initResponse = await stub.fetch(
    new Request("http://do/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        repoId: parsed.data.repoId,
        settings: parsed.data.settings,
      }),
    })
  );

  if (!initResponse.ok) {
    const error = await initResponse.text();
    return c.json({ error: "Failed to create session", details: error }, 500);
  }

  const host = c.req.header("host") ?? "localhost";
  const protocol = host.includes("localhost") ? "ws" : "wss";
  const wsUrl = `${protocol}://${host}/api/sessions/${sessionId}/ws`;

  return c.json({ sessionId, wsUrl }, 201);
});

// Get session info
sessionsRoutes.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = getSessionAgent(sessionId, c);

  const response = await stub.fetch(new Request("http://do/session"));
  if (!response.ok) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json(await response.json());
});

// WebSocket upgrade
sessionsRoutes.get("/:sessionId/ws", async (c) => {
  const sessionId = c.req.param("sessionId");
  const upgradeHeader = c.req.header("Upgrade");

  if (upgradeHeader !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }

  const stub = getSessionAgent(sessionId, c);

  // Forward the WebSocket upgrade to the DO
  return stub.fetch(c.req.raw);
});

// Get messages for a session
sessionsRoutes.get("/:sessionId/messages", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = getSessionAgent(sessionId, c);

  const response = await stub.fetch(new Request("http://do/messages"));
  if (!response.ok) {
    return c.json({ error: "Failed to get messages" }, 500);
  }

  return c.json(await response.json());
});

// Delete a session
sessionsRoutes.delete("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = getSessionAgent(sessionId, c);

  const response = await stub.fetch(
    new Request("http://do/session", { method: "DELETE" })
  );

  if (!response.ok) {
    return c.json({ error: "Failed to delete session" }, 500);
  }

  return c.json({ deleted: true });
});
