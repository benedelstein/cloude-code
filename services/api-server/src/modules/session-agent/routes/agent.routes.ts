import { Hono } from "hono";
import type { Env } from "@/shared/types";
import { createLogger } from "@/shared/logging";
import { openSessionTerminal } from "../services/session-terminal-relay.service";
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

  /**
   * Verifies the session WebSocket token and repo access for an agent route.
   * Returns the authenticated payload, or an error Response to send as-is.
   */
  async function authenticateSessionSocket(
    env: Env,
    requestUrl: URL,
    sessionId: string,
  ): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
    const token = requestUrl.searchParams.get("token");

    if (!token) {
      return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    }

    const tokenPayload = await deps.verifySessionWebSocketToken(
      env.WEBSOCKET_TOKEN_SIGNING_KEY,
      token,
    );

    if (!tokenPayload || tokenPayload.sessionId !== sessionId) {
      return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    }

    const accessResult = await deps.assertSessionRepoAccess({
      env,
      sessionId,
      userId: tokenPayload.userId,
    });

    if (!accessResult.ok) {
      if (accessResult.error.code === "REPO_ACCESS_BLOCKED") {
        await deps.requestSessionAccessBlockedCleanup(env, sessionId);
        return {
          ok: false,
          response: Response.json(
            { error: accessResult.error.message, code: accessResult.error.code },
            { status: accessResult.error.status },
          ),
        };
      }

      if (accessResult.error.code === "GITHUB_AUTH_REQUIRED") {
        return {
          ok: false,
          response: Response.json(
            { error: accessResult.error.message, code: accessResult.error.code },
            { status: 401 },
          ),
        };
      }

      if (accessResult.error.status === 503) {
        logger.warn("Session access check temporarily unavailable", {
          fields: { sessionId, code: accessResult.error.code },
        });
        return {
          ok: false,
          response: Response.json(
            { error: accessResult.error.message, code: accessResult.error.code },
            { status: 503 },
          ),
        };
      }

      logger.log("Session access denied", {
        fields: { sessionId, code: accessResult.error.code },
      });
      return { ok: false, response: Response.json({ error: "Session not found" }, { status: 404 }) };
    }

    return { ok: true, userId: tokenPayload.userId };
  }

  agentRoutes.all("/session/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const requestUrl = new URL(c.req.url);

    const auth = await authenticateSessionSocket(c.env, requestUrl, sessionId);
    if (!auth.ok) {
      return auth.response;
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

  agentRoutes.all("/session/:sessionId/terminal", async (c) => {
    const sessionId = c.req.param("sessionId");
    const requestUrl = new URL(c.req.url);

    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: "Expected WebSocket upgrade" }, 426);
    }

    const auth = await authenticateSessionSocket(c.env, requestUrl, sessionId);
    if (!auth.ok) {
      return auth.response;
    }

    const stub = await getSessionAgentStub(c.env, sessionId);
    const target = await stub.handleGetTerminalTarget();
    if (!target.ok) {
      switch (target.error.code) {
        case "SESSION_NOT_INITIALIZED":
          return c.json({ error: target.error.message, code: target.error.code }, 404);
        case "SPRITE_NOT_PROVISIONED":
          return c.json({ error: target.error.message, code: target.error.code }, 409);
        default: {
          const exhaustiveCheck: never = target.error;
          throw new Error(`Unhandled terminal target error: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    }

    return openSessionTerminal({
      env: c.env,
      sessionId,
      spriteName: target.value.spriteName,
      terminalSessionId: target.value.terminalSessionId,
      persistTerminalSessionId: (terminalSessionId) => {
        void stub.handleSetTerminalSessionId(terminalSessionId);
      },
      cols: parseDimension(requestUrl.searchParams.get("cols")),
      rows: parseDimension(requestUrl.searchParams.get("rows")),
    });
  });

  return agentRoutes;
}

/** Parses a positive integer terminal dimension query param, or undefined. */
function parseDimension(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) {
    return undefined;
  }
  return parsed;
}
