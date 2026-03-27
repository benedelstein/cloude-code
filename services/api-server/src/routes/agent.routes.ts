import { Hono } from "hono";
import { getAgentByName } from "agents";
import type { Env } from "@/types";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import { verifySessionWebSocketToken } from "@/lib/session-websocket-token";

export const agentRoutes = new Hono<{ Bindings: Env }>();

// Repo access is verified when the websocket token is minted (within the last
// 5 minutes). Token signature verification here is sufficient.
agentRoutes.all("/session/:sessionId", async (c) => {
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

  requestUrl.searchParams.delete("token"); // sanitize token, no longer needed
  const stub = await getAgentByName<Env, SessionAgentDO>(c.env.SESSION_AGENT, sessionId);
  const doRequest = new Request(`http://do${requestUrl.pathname}${requestUrl.search}`, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  });
  return stub.fetch(doRequest);
});
