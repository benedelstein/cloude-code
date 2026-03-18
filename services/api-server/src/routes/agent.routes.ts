import { Hono } from "hono";
import { getAgentByName } from "agents";
import type { Env } from "@/types";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import { SessionHistoryService } from "@/lib/session-history";
import { verifySessionWebSocketToken } from "@/lib/session-websocket-token";
import { createLogger } from "@/lib/logger";

export const agentRoutes = new Hono<{ Bindings: Env }>();
const logger = createLogger("agent.routes.ts");

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
