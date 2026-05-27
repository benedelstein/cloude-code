import { Hono } from "hono";
import type { Env } from "@/shared/types";
import { createLogger } from "@/shared/logging";
import { getSessionAgentStub } from "./session-agent-stub";

interface SessionTokenPayload {
  sessionId: string;
  userId: string;
}

type SessionAccessResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: string;
        status: 400 | 401 | 403 | 404 | 500 | 503;
        message: string;
      };
    };

export interface AgentRouteDeps {
  verifySessionWebSocketToken(
    signingKey: string,
    token: string,
  ): Promise<SessionTokenPayload | null>;
  assertSessionRepoAccess(input: {
    env: Env;
    sessionId: string;
    userId: string;
  }): Promise<SessionAccessResult>;
  requestSessionAccessBlockedCleanup(
    env: Env,
    sessionId: string,
  ): Promise<void>;
}

export function createAgentRoutes(
  deps: AgentRouteDeps,
): Hono<{ Bindings: Env }> {
  const agentRoutes = new Hono<{ Bindings: Env }>();
  const logger = createLogger("agent.routes.ts");

  agentRoutes.all("/session/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const requestUrl = new URL(c.req.url);
    const token = requestUrl.searchParams.get("token");

    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const tokenPayload = await deps.verifySessionWebSocketToken(
      c.env.WEBSOCKET_TOKEN_SIGNING_KEY,
      token,
    );

    if (!tokenPayload || tokenPayload.sessionId !== sessionId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const accessResult = await deps.assertSessionRepoAccess({
      env: c.env,
      sessionId,
      userId: tokenPayload.userId,
    });

    if (!accessResult.ok) {
      if (accessResult.error.code === "REPO_ACCESS_BLOCKED") {
        await deps.requestSessionAccessBlockedCleanup(c.env, sessionId);
        return c.json(
          {
            error: accessResult.error.message,
            code: accessResult.error.code,
          },
          accessResult.error.status,
        );
      }

      if (accessResult.error.code === "GITHUB_AUTH_REQUIRED") {
        return c.json(
          {
            error: accessResult.error.message,
            code: accessResult.error.code,
          },
          401,
        );
      }

      if (accessResult.error.status === 503) {
        logger.warn("Session access check temporarily unavailable", {
          fields: { sessionId, code: accessResult.error.code },
        });
        return c.json(
          {
            error: accessResult.error.message,
            code: accessResult.error.code,
          },
          503,
        );
      }

      logger.log("Session access denied", {
        fields: { sessionId, code: accessResult.error.code },
      });
      return c.json({ error: "Session not found" }, 404);
    }

    requestUrl.searchParams.delete("token"); // sanitize token, no longer needed
    const stub = await getSessionAgentStub(c.env, sessionId);
    const doRequest = new Request(
      `http://do${requestUrl.pathname}${requestUrl.search}`,
      {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      },
    );
    return stub.fetch(doRequest);
  });

  return agentRoutes;
}
