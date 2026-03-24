import { OpenAPIHono } from "@hono/zod-openapi";
import { SessionsService } from "@/lib/sessions/sessions.service";
import { authMiddleware, type AuthUser } from "@/middleware/auth.middleware";
import type { Env } from "@/types";
import {
  archiveSessionRoute,
  closeEditorRoute,
  createPullRequestRoute,
  createSessionRoute,
  createSessionWebSocketTokenRoute,
  deleteSessionRoute,
  getPullRequestRoute,
  getSessionMessagesRoute,
  getSessionPlanRoute,
  getSessionRoute,
  listSessionsRoute,
  openEditorRoute,
  updateSessionTitleRoute,
} from "./schema";

export const sessionsRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

sessionsRoutes.use("*", authMiddleware);

// List sessions for the current user
sessionsRoutes.openapi(listSessionsRoute, async (c) => {
  const user = c.get("user");
  const { repoId, limit, cursor } = c.req.valid("query");
  const sessionsService = new SessionsService(c.env);

  const sessions = await sessionsService.listSessions({
    userId: user.id,
    repoId,
    limit,
    cursor: cursor ?? undefined,
  });

  return c.json(sessions, 200);
});

// Create a new session
sessionsRoutes.openapi(createSessionRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = new SessionsService(c.env);
  const result = await sessionsService.createSession({
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
    request: c.req.valid("json"),
  });

  if (!result.ok) {
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
    if (result.error.status === 422) {
      return c.json({
        error: result.error.message,
        ...(result.error.details ? { details: result.error.details } : {}),
        ...(result.error.code ? { code: result.error.code } : {}),
      }, 422);
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
  const sessionsService = new SessionsService(c.env);
  const result = await sessionsService.getSession({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_REVOKED",
      }, 403);
    }

    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 200);
});

sessionsRoutes.openapi(createSessionWebSocketTokenRoute, async (c) => {
  const user = c.get("user");
  const sessionsService = new SessionsService(c.env);
  const result = await sessionsService.createSessionWebSocketToken({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
  });

  if (!result.ok) {
    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 200);
});

// Update session title
sessionsRoutes.openapi(updateSessionTitleRoute, async (c) => {
  const user = c.get("user");
  const { sessionId } = c.req.valid("param");
  const { title } = c.req.valid("json");
  const sessionsService = new SessionsService(c.env);
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
  const sessionsService = new SessionsService(c.env);
  const result = await sessionsService.getSessionMessages({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_REVOKED",
      }, 403);
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
  const sessionsService = new SessionsService(c.env);
  const result = await sessionsService.getSessionPlan({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_REVOKED",
      }, 403);
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
  const sessionsService = new SessionsService(c.env);
  const result = await sessionsService.createPullRequest({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_REVOKED",
      }, 403);
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
  const sessionsService = new SessionsService(c.env);
  const result = await sessionsService.getPullRequest({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_REVOKED",
      }, 403);
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
  const sessionsService = new SessionsService(c.env);
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
  const sessionsService = new SessionsService(c.env);
  const result = await sessionsService.deleteSession({
    sessionId: c.req.valid("param").sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });

  if (!result.ok) {
    if (result.error.status === 403) {
      return c.json({
        error: result.error.message,
        code: result.error.code ?? "REPO_ACCESS_REVOKED",
      }, 403);
    }
    if (result.error.status === 500) {
      return c.json({ error: result.error.message }, 500);
    }

    return c.json({ error: result.error.message }, 404);
  }

  return c.json(result.value, 200);
});

// Open VS Code editor on the Sprite VM
sessionsRoutes.openapi(openEditorRoute, async (c) => {
  // const user = c.get("user");
  // const sessionsService = new SessionsService(c.env);
  return c.json({ error: "Not implemented" }, 501);
  // const result = await sessionsService.openEditor({
  //   sessionId: c.req.valid("param").sessionId,
  //   userId: user.id,
  //   githubAccessToken: user.githubAccessToken,
  // });

  // if (!result.ok) {
  //   if (result.error.status === 403) {
  //     return c.json({
  //       error: result.error.message,
  //       code: result.error.code ?? "REPO_ACCESS_REVOKED",
  //     }, 403);
  //   }
  //   if (result.error.status === 400) {
  //     return c.json({
  //       error: result.error.message,
  //       details: result.error.details ?? result.error.message,
  //     }, 400);
  //   }
  //   if (result.error.status === 500) {
  //     return c.json({
  //       error: result.error.message,
  //       details: result.error.details ?? result.error.message,
  //     }, 500);
  //   }

  //   return c.json({ error: result.error.message }, 404);
  // }

  // return c.json(result.value, 200);
});

// Close VS Code editor on the Sprite VM
sessionsRoutes.openapi(closeEditorRoute, async (c) => {
  return c.json({ error: "Not implemented" }, 501);
  // const user = c.get("user");
  // const sessionsService = new SessionsService(c.env);
  // const result = await sessionsService.closeEditor({
  //   sessionId: c.req.valid("param").sessionId,
  //   userId: user.id,
  //   githubAccessToken: user.githubAccessToken,
  // });

  // if (!result.ok) {
  //   if (result.error.status === 403) {
  //     return c.json({
  //       error: result.error.message,
  //       code: result.error.code ?? "REPO_ACCESS_REVOKED",
  //     }, 403);
  //   }
  //   if (result.error.status === 400) {
  //     return c.json({
  //       error: result.error.message,
  //       details: result.error.details ?? result.error.message,
  //     }, 400);
  //   }
  //   if (result.error.status === 500) {
  //     return c.json({
  //       error: result.error.message,
  //       details: result.error.details ?? result.error.message,
  //     }, 500);
  //   }

  //   return c.json({ error: result.error.message }, 404);
  // }

  // return c.json(result.value, 200);
});
