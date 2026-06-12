import { Hono } from "hono";
import type { Env } from "@/shared/types";
import { getSessionAgentStub } from "./session-agent-stub";

export function createConnectorProxyRoutes(): Hono<{ Bindings: Env }> {
  const connectorProxyRoutes = new Hono<{ Bindings: Env }>();

  // Forward intercepted egress requests to the session's DO, which injects the
  // connector's real secret. Auth is handled inside the DO via a per-session
  // bearer secret.
  connectorProxyRoutes.all("/:sessionId/:connectorId/*", async (c) => {
    const sessionId = c.req.param("sessionId");
    const stub = await getSessionAgentStub(c.env, sessionId);
    return stub.handleConnectorProxy(c.req.raw);
  });

  return connectorProxyRoutes;
}
