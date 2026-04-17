import { Hono } from "hono";
import { getAgentByName } from "agents";
import type { Env } from "@/types";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";

export const gitProxyRoutes = new Hono<{ Bindings: Env }>();

// Forward to the session's DO for authenticated git operations.
// The DO handles authentication internally via a shared secret.
gitProxyRoutes.all("/:sessionId/*", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getAgentByName<Env, SessionAgentDO>(c.env.SESSION_AGENT, sessionId);
  const url = new URL(c.req.url);
  // TODO: REPLACE WITH RPC METHOD
  const doRequest = new Request(`http://do${url.pathname}${url.search}`, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  });
  return stub.fetch(doRequest);
});
