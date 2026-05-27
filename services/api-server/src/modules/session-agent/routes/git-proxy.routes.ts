import { Hono } from "hono";
import type { Env } from "@/shared/types";
import { getSessionAgentStub } from "./session-agent-stub";

export function createGitProxyRoutes(): Hono<{ Bindings: Env }> {
  const gitProxyRoutes = new Hono<{ Bindings: Env }>();

  // Forward to the session's DO for authenticated git operations.
  // The DO handles authentication internally via a shared secret.
  gitProxyRoutes.all("/:sessionId/*", async (c) => {
    const sessionId = c.req.param("sessionId");
    const stub = await getSessionAgentStub(c.env, sessionId);
    return stub.handleGitProxy(c.req.raw);
  });

  return gitProxyRoutes;
}
