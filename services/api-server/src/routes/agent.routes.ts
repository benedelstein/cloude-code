import { Hono } from "hono";
import { getAgentByName } from "agents";
import type { Env } from "@/types";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import { verifySessionWebSocketToken } from "@/lib/session-websocket-token";
import { createLogger } from "@/lib/logger";
import {
  assertSessionRepoAccess,
  REPO_ACCESS_REVOKED_CODE,
} from "@/lib/session-repo-access";
import { requestSessionRevocationCleanup } from "@/lib/session-revocation";

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

  const accessResult = await assertSessionRepoAccess({
    env: c.env,
    sessionId,
    userId: tokenPayload.userId,
  });

  if (!accessResult.ok) {
    if (accessResult.error.code === REPO_ACCESS_REVOKED_CODE) {
      await requestSessionRevocationCleanup(c.env, sessionId);
      return c.json(
        {
          error: accessResult.error.message,
          code: accessResult.error.code,
        },
        accessResult.error.status,
      );
    }

    logger.log(`${sessionId} session access denied: ${accessResult.error.code}`);
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
