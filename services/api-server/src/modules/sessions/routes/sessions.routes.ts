import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { SessionsService } from "../services/sessions.service";
import type { AuthContext } from "@/shared/types/auth";
import type { Env } from "@/shared/types";
import { USER_SESSIONS_USER_ID_HEADER } from "@/shared/types/user-sessions";
import {
  archiveSessionRoute,
  createPullRequestRoute,
  createSessionRoute,
  createSessionWebSocketTokenRoute,
  createUserSessionsWebSocketTokenRoute,
  deleteSessionRoute,
  getPullRequestRoute,
  getSessionMessagesRoute,
  getSessionPlanRoute,
  getSessionSetupOutputRoute,
  getSessionRoute,
  getUserSessionsUpdatesRoute,
  listSessionsRoute,
  updateSessionTitleRoute,
} from "./sessions.schema";

type SessionsRouteEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};

export interface SessionsRouteDeps {
  authMiddleware: MiddlewareHandler<SessionsRouteEnv>;
  createSessionsService(env: Env): SessionsService;
  verifyUserSessionsWebSocketToken(
    signingKey: string,
    token: string,
  ): Promise<{ userId: string } | null>;
}

export function createSessionsRoutes(
  deps: SessionsRouteDeps,
): OpenAPIHono<SessionsRouteEnv> {
  const sessionsRoutes = new OpenAPIHono<SessionsRouteEnv>();

  sessionsRoutes.openapi(getUserSessionsUpdatesRoute, async (c) => {
    const { token } = c.req.valid("query");
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const tokenPayload = await deps.verifyUserSessionsWebSocketToken(
      c.env.WEBSOCKET_TOKEN_SIGNING_KEY,
      token,
    );
    if (!tokenPayload) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const headers = new Headers(c.req.raw.headers);
    headers.set(USER_SESSIONS_USER_ID_HEADER, tokenPayload.userId);
    const stub = c.env.USER_SESSIONS.getByName(tokenPayload.userId);
    const doRequest = new Request("http://user-sessions/", {
      method: c.req.method,
      headers,
    });
    return stub.fetch(doRequest);
  });

  sessionsRoutes.use("*", deps.authMiddleware);

  // List sessions for the current user, grouped by repo for the sidebar.
  sessionsRoutes.openapi(listSessionsRoute, async (c) => {
    const auth = c.get("auth");
    const { repoId, repoCursor, sessionCursor, repoLimit, sessionLimit } =
      c.req.valid("query");
    const sessionsService = deps.createSessionsService(c.env);

    const response = await sessionsService.listSessions({
      userId: auth.userId,
      repoId,
      repoCursor,
      sessionCursor,
      repoLimit,
      sessionLimit,
    });

    return c.json(response, 200);
  });

  // Create a new session
  sessionsRoutes.openapi(createSessionRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.createSession({
      userId: auth.userId,
      request: c.req.valid("json"),
    });

    if (!result.ok) {
      if (result.error.status === 429) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "SESSION_RATE_LIMIT_EXCEEDED",
          },
          429,
        );
      }
      if (result.error.status === 400) {
        return c.json({ error: result.error.message }, 400);
      }
      if (result.error.status === 401) {
        return c.json(
          {
            error: result.error.message,
            details: result.error.details ?? result.error.message,
            ...(result.error.code ? { code: result.error.code } : {}),
          },
          401,
        );
      }
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_NOT_ACCESSIBLE",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }

      return c.json(
        {
          error: result.error.message,
          details: result.error.details ?? result.error.message,
          ...(result.error.code ? { code: result.error.code } : {}),
        },
        500,
      );
    }

    return c.json(result.value, 201);
  });

  // Get session info
  sessionsRoutes.openapi(getSessionRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.getSession({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
    });

    if (!result.ok) {
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_ACCESS_BLOCKED",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }

      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  sessionsRoutes.openapi(createSessionWebSocketTokenRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.createSessionWebSocketToken({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
    });

    if (!result.ok) {
      if (result.error.status === 401) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_AUTH_REQUIRED",
          },
          401,
        );
      }
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_ACCESS_BLOCKED",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }
      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  sessionsRoutes.openapi(createUserSessionsWebSocketTokenRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const token = await sessionsService.createUserSessionsWebSocketToken({
      userId: auth.userId,
    });

    return c.json(token, 200);
  });

  // Update session title
  sessionsRoutes.openapi(updateSessionTitleRoute, async (c) => {
    const auth = c.get("auth");
    const { sessionId } = c.req.valid("param");
    const { title } = c.req.valid("json");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.updateSessionTitle({
      sessionId,
      userId: auth.userId,
      title,
    });

    if (!result.ok) {
      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  // Get messages for a session
  sessionsRoutes.openapi(getSessionMessagesRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.getSessionMessages({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
    });

    if (!result.ok) {
      if (result.error.status === 401) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_AUTH_REQUIRED",
          },
          401,
        );
      }
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_ACCESS_BLOCKED",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }
      if (result.error.status === 500) {
        return c.json({ error: result.error.message }, 500);
      }

      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  sessionsRoutes.openapi(getSessionPlanRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.getSessionPlan({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
    });

    if (!result.ok) {
      if (result.error.status === 401) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_AUTH_REQUIRED",
          },
          401,
        );
      }
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_ACCESS_BLOCKED",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }
      if (result.error.status === 500) {
        return c.json({ error: result.error.message }, 500);
      }

      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  sessionsRoutes.openapi(getSessionSetupOutputRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.getSessionSetupOutput({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
    });

    if (!result.ok) {
      if (result.error.status === 401) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_AUTH_REQUIRED",
          },
          401,
        );
      }
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_ACCESS_BLOCKED",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }
      if (result.error.status === 500) {
        return c.json({ error: result.error.message }, 500);
      }

      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  // Create a pull request for a session's pushed branch
  sessionsRoutes.openapi(createPullRequestRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.createPullRequest({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
    });

    if (!result.ok) {
      if (result.error.status === 401) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_AUTH_REQUIRED",
          },
          401,
        );
      }
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_ACCESS_BLOCKED",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }
      if (result.error.status === 409) {
        return c.json(
          {
            error: result.error.message,
            url: result.error.url ?? "",
          },
          409,
        );
      }
      if (result.error.status === 400) {
        return c.json(
          {
            error: result.error.message,
            ...(result.error.details ? { details: result.error.details } : {}),
          },
          400,
        );
      }

      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 201);
  });

  // Check pull request status
  sessionsRoutes.openapi(getPullRequestRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.getPullRequest({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
    });

    if (!result.ok) {
      if (result.error.status === 401) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_AUTH_REQUIRED",
          },
          401,
        );
      }
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_ACCESS_BLOCKED",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }
      if (result.error.status === 500) {
        return c.json({ error: result.error.message }, 500);
      }
      if (result.error.status === 400) {
        return c.json({ error: result.error.message }, 400);
      }

      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  // Archive a session (hide from list but preserve data)
  sessionsRoutes.openapi(archiveSessionRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.archiveSession({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
    });

    if (!result.ok) {
      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  // Delete a session
  sessionsRoutes.openapi(deleteSessionRoute, async (c) => {
    const auth = c.get("auth");
    const sessionsService = deps.createSessionsService(c.env);
    const result = await sessionsService.deleteSession({
      sessionId: c.req.valid("param").sessionId,
      userId: auth.userId,
      executionCtx: c.executionCtx,
    });

    if (!result.ok) {
      if (result.error.status === 401) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_AUTH_REQUIRED",
          },
          401,
        );
      }
      if (result.error.status === 403) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "REPO_ACCESS_BLOCKED",
          },
          403,
        );
      }
      if (result.error.status === 503) {
        return c.json(
          {
            error: result.error.message,
            code: result.error.code ?? "GITHUB_API_ERROR",
          },
          503,
        );
      }
      if (result.error.status === 500) {
        return c.json({ error: result.error.message }, 500);
      }

      return c.json({ error: result.error.message }, 404);
    }

    return c.json(result.value, 200);
  });

  return sessionsRoutes;
}
