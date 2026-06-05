import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { SessionsService } from "../services/sessions.service";
import type { AuthUser } from "@/shared/types/auth";
import type { Env } from "@/shared/types";
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
  getSessionRoute,
  listSessionsRoute,
  updateSessionTitleRoute,
} from "./sessions.schema";

type SessionsRouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
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

  sessionsRoutes.get("/updates", async (c) => {
    const requestUrl = new URL(c.req.url);
    const token = requestUrl.searchParams.get("token");
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
    headers.set("X-User-Id", tokenPayload.userId);
    requestUrl.searchParams.delete("token");
    const stub = c.env.USER_SESSIONS.getByName(tokenPayload.userId);
    const doRequest = new Request(
      `http://user-sessions${requestUrl.pathname}${requestUrl.search}`,
      {
        method: c.req.method,
        headers,
        body: c.req.raw.body,
      },
    );
    return stub.fetch(doRequest);
  });

  sessionsRoutes.use("*", deps.authMiddleware);

// List sessions for the current user, grouped by repo for the sidebar.
sessionsRoutes.openapi(listSessionsRoute, async (c) => {
  const user = c.get("user");
  const { repoId, repoCursor, sessionCursor, repoLimit, sessionLimit } =
    c.req.valid("query");
  const sessionsService = deps.createSessionsService(c.env);

  const response = await sessionsService.listSessions({
    userId: user.id,
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
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.createSession({
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
    request: c.req.valid("json"),
  });

  if (!result.ok) {
    if (result.error.status === 429) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "SESSION_RATE_LIMIT_EXCEEDED",
      }, 429);
    }
    if (result.error.status === 400) {
      return c.json({ error: result.error.message }, 400);
    }
    if (result.error.status === 401) {
      return c.json({
        error: result.error.message,
        details: result.error.details ?? result.error.message,
        ...(result.error.code ? { code: result.error.code } : {}),
      }, 401);
    }
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_NOT_ACCESSIBLE",
      }, 403);
    }
    if (result.error.status === 503) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "GITHUB_API_ERROR",
      }, 503);
    }

    return c.json({
      error: result.error.message,
      details: result.error.details ?? result.error.message,
      ...(result.error.code ? { code: result.error.code } : {}),
    }, 500);
  }

  return c.json(result.value, 201);
});

// Get session info
sessionsRoutes.openapi(getSessionRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.getSession({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_BLOCKED",
      }, 403);
    }
    if (result.error.status === 503) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "GITHUB_API_ERROR",
      }, 503);
    }

    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 200);
});

sessionsRoutes.openapi(createSessionWebSocketTokenRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.createSessionWebSocketToken({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_BLOCKED",
      }, 403);
    }
    if (result.error.status === 503) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "GITHUB_API_ERROR",
      }, 503);
    }
    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 200);
});

sessionsRoutes.openapi(createUserSessionsWebSocketTokenRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const token = await sessionsService.createUserSessionsWebSocketToken({
    userId: user.id,
  });

  return c.json(token, 200);
});

// Update session title
sessionsRoutes.openapi(updateSessionTitleRoute, async (c) => {
  const user = c.get("user");
  const { sessionId } = c.req.valid("param");
  const { title } = c.req.valid("json");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.updateSessionTitle({
    sessionId,
    userId: user.id,
    title,
  });

  if (!result.ok) {
    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 200);
});

// Get messages for a session
sessionsRoutes.openapi(getSessionMessagesRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.getSessionMessages({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_BLOCKED",
      }, 403);
    }
    if (result.error.status === 503) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "GITHUB_API_ERROR",
      }, 503);
    }
    if (result.error.status === 500) {
      return c.json({ error: result.error.message }, 500);
    }

    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 200);
});

sessionsRoutes.openapi(getSessionPlanRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.getSessionPlan({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_BLOCKED",
      }, 403);
    }
    if (result.error.status === 503) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "GITHUB_API_ERROR",
      }, 503);
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
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.createPullRequest({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_BLOCKED",
      }, 403);
    }
    if (result.error.status === 503) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "GITHUB_API_ERROR",
      }, 503);
    }
    if (result.error.status === 409) {
      return c.json({
        error: result.error.message,
        url: result.error.url ?? "",
      }, 409);
    }
    if (result.error.status === 400) {
      return c.json({
        error: result.error.message,
        ...(result.error.details ? { details: result.error.details } : {}),
      }, 400);
    }

    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 201);
});

// Check pull request status
sessionsRoutes.openapi(getPullRequestRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.getPullRequest({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_BLOCKED",
      }, 403);
    }
    if (result.error.status === 503) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "GITHUB_API_ERROR",
      }, 503);
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
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.archiveSession({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
  });

  if (!result.ok) {
    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 200);
});

// Delete a session
sessionsRoutes.openapi(deleteSessionRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = deps.createSessionsService(c.env);
  const result = await sessionsService.deleteSession({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_BLOCKED",
      }, 403);
    }
    if (result.error.status === 503) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "GITHUB_API_ERROR",
      }, 503);
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
