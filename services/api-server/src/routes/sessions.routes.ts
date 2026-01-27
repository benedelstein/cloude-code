import { Context, Hono } from "hono";
import { CreateSessionRequest, type SessionInfo } from "@repo/shared";
import type { Env } from "../types";
import { getAgentByName, routeAgentRequest } from "agents";
import type { SessionAgentDO } from "../durable-objects/session-agent-do";

export const sessionsRoutes = new Hono<{ Bindings: Env }>();

const getSessionAgent = async (id: string, c: Context<{ Bindings: Env }>) => {
  // Use getAgentByName to properly route requests (including WebSockets)
  // This adds the headers that PartyServer/Agents SDK expects
  return await getAgentByName<Env, SessionAgentDO>(c.env.SESSION_AGENT, id);
};

// Create a new session
sessionsRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateSessionRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const sessionId = crypto.randomUUID();
  console.log("creating session agent", sessionId);
  const stub = await getSessionAgent(sessionId, c);

  // Initialize the session in the DO
  const initResponse = await stub.fetch(
    new Request("http://do/", {
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
  const wsUrl = `${protocol}://${host}/sessions/${sessionId}/ws`;

  return c.json({ sessionId, wsUrl }, 201);
});

// Get session info
sessionsRoutes.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getSessionAgent(sessionId, c);

  const response = await stub.fetch(new Request("http://do/"));
  if (!response.ok) {
    return c.json({ error: "Session not found" }, 404);
  }

  const session = (await response.json()) as SessionInfo;

  // Add wsUrl for client reconnection
  const host = c.req.header("host") ?? "localhost";
  const protocol = host.includes("localhost") ? "ws" : "wss";
  const wsUrl = `${protocol}://${host}/sessions/${sessionId}/ws`;

  return c.json({ ...session, wsUrl });
});

// WebSocket upgrade
sessionsRoutes.get("/:sessionId/ws", async (c) => {
  const sessionId = c.req.param("sessionId");
  const upgradeHeader = c.req.header("Upgrade");

  if (upgradeHeader !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }
  const stub = await getSessionAgent(sessionId, c);
  // Forward the WebSocket upgrade to the DO
  return stub.fetch(c.req.raw);
});

// Get messages for a session
sessionsRoutes.get("/:sessionId/messages", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getSessionAgent(sessionId, c);

  const response = await stub.fetch(new Request("http://do/messages"));
  if (!response.ok) {
    return c.json({ error: "Failed to get messages" }, 500);
  }

  return c.json(await response.json());
});

// Delete a session
sessionsRoutes.delete("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getSessionAgent(sessionId, c);

  const response = await stub.fetch(
    new Request("http://do/", { method: "DELETE" })
  );

  if (!response.ok) {
    return c.json({ error: "Failed to delete session" }, 500);
  }

  return c.json({ deleted: true });
});
