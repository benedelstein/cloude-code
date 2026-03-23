import { OpenAPIHono, z } from "@hono/zod-openapi";
import {
  EditorCloseResponse,
  EditorOpenResponse,
  SessionInfoResponse,
  SessionPlanResponse,
  UIMessageSchema,
} from "@repo/shared";
import type { Env } from "@/types";
import { getAgentByName } from "agents";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import {
  GitHubAppService,
  GitHubAppError,
} from "@/lib/github";
import { createLogger } from "@/lib/logger";
import { SessionHistoryService } from "@/lib/session-history";
import {
  assertSessionRepoAccess,
  REPO_ACCESS_REVOKED_CODE,
} from "@/lib/session-repo-access";
import { requestSessionRevocationCleanup } from "@/lib/session-revocation";
import {
  createPullRequestForSession,
  getPullRequestStatusForSession,
  SessionPullRequestServiceError,
} from "@/lib/session-pull-request-service";
import { generateSessionTitle } from "@/lib/generate-session-title";
import { AttachmentService } from "@/lib/attachments/attachment-service";
import { authMiddleware, type AuthUser } from "@/middleware/auth.middleware";
import {
  listSessionsRoute,
  createSessionRoute,
  getSessionRoute,
  createSessionWebSocketTokenRoute,
  updateSessionTitleRoute,
  getSessionMessagesRoute,
  getSessionPlanRoute,
  createPullRequestRoute,
  getPullRequestRoute,
  archiveSessionRoute,
  deleteSessionRoute,
  openEditorRoute,
  closeEditorRoute,
} from "./schema";
import { mintSessionWebSocketToken } from "@/lib/session-websocket-token";

export const sessionsRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();
const logger = createLogger("sessions.routes.ts");

sessionsRoutes.use("*", authMiddleware);

class SessionInitializationError extends Error {
  readonly status: number;
  readonly details: string;
  readonly code?: string;

  constructor(
    status: number,
    details: string,
    code?: string,
  ) {
    super(details);
    this.name = "SessionInitializationError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

const getSessionAgent = async (id: string, env: Env) => {
  return await getAgentByName<Env, SessionAgentDO>(env.SESSION_AGENT, id);
};

const getAuthorizedSessionAgent = async (
  sessionId: string,
  user: AuthUser,
  env: Env,
): Promise<
  | { ok: true; stub: Awaited<ReturnType<typeof getSessionAgent>> }
  | { ok: false; status: 404; body: { error: string } }
  | { ok: false; status: 403; body: { error: string; code: string } }
> => {
  const accessResult = await assertSessionRepoAccess({
    env,
    sessionId,
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
  });
  if (!accessResult.ok) {
    if (accessResult.error.code === REPO_ACCESS_REVOKED_CODE) {
      await requestSessionRevocationCleanup(env, sessionId);
      return {
        ok: false,
        status: 403,
        body: {
          error: accessResult.error.message,
          code: accessResult.error.code,
        },
      };
    }

    return {
      ok: false,
      status: 404,
      body: { error: "Session not found" },
    };
  }

  return { ok: true, stub: await getSessionAgent(sessionId, env) };
};

const sessionMessagesResponseSchema = z.array(UIMessageSchema);

// List sessions for the current user
sessionsRoutes.openapi(listSessionsRoute, async (c) => {
  const user = c.get("user");
  const { repoId, limit, cursor } = c.req.valid("query");

  const sessionHistory = new SessionHistoryService(c.env.DB);
  const result = await sessionHistory.listByUser(user.id, {
    repoId,
    limit,
    cursor: cursor ?? undefined,
  });

  return c.json(result, 200);
});

// Create a new session
sessionsRoutes.openapi(createSessionRoute, async (c) => {
  const createSessionData = c.req.valid("json");
  const user = c.get("user");

  // Verify that the GitHub App installation exists for this repo and is accessible to the user
  // before creating the session
  const github = new GitHubAppService(c.env, logger);
  let installation: { id: number };
  let repository: {
    id: number;
    fullName: string;
    owner: string;
    name: string;
    defaultBranch?: string;
  };
  try {
    // first find the installation for the repo
    installation = await github.findInstallationForRepoId(
      createSessionData.repoId,
      user.githubAccessToken,
    );
    repository = await github.getUserAccessibleInstallationRepoById(
      user.id,
      user.githubAccessToken,
      installation.id,
      createSessionData.repoId,
    );
  } catch (error) {
    logger.error(`Failed to find installation for repo ${createSessionData.repoId}`, { error });
    if (error instanceof GitHubAppError) {
      return c.json({ error: error.message, code: error.code }, 422);
    }
    throw error;
  }

  const sessionId = crypto.randomUUID();
  logger.info("Creating session agent", {
    fields: {
      sessionId,
      userId: user.id,
      repositoryFullName: repository.fullName,
    },
  });
  const sessionHistory = new SessionHistoryService(c.env.DB);
  const attachmentService = new AttachmentService(c.env.DB);
  const attachmentIds = [...new Set(createSessionData.attachmentIds ?? [])];

  // Record session in D1 for history listing. Attachments reference sessions via FK.
  await sessionHistory.create({
    id: sessionId,
    userId: user.id,
    repoId: repository.id,
    installationId: installation.id,
    repoFullName: repository.fullName,
  });
  let attachmentsBound = false;

  try {
    if (attachmentIds.length > 0) {
      const bound = await attachmentService.bindUnboundOwnedToSession(
        attachmentIds,
        user.id,
        sessionId,
      );
      if (!bound) {
        await sessionHistory.delete(sessionId);
        return c.json(
          {
            error: "Failed to bind one or more attachments. Ensure they exist, are unbound, and are owned by you.",
          },
          400,
        );
      }
      attachmentsBound = true;
    }

    const stub = await getSessionAgent(sessionId, c.env);
    // Initialize the session in the DO (token fetched internally by the DO)
    const initResponse = await stub.fetch(
      new Request("http://do/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          userId: user.id,
          repoFullName: repository.fullName,
        settings: createSessionData.settings,
        branch: createSessionData.branch,
        initialMessage: createSessionData.initialMessage,
        initialAttachmentIds: attachmentIds,
      }),
    }),
  );

    if (!initResponse.ok) {
      const responseText = await initResponse.text();
      let responseBody: { error?: string; code?: string } | null = null;
      try {
        responseBody = JSON.parse(responseText) as { error?: string; code?: string };
      } catch {
        responseBody = null;
      }

      throw new SessionInitializationError(
        initResponse.status,
        responseBody?.error ?? (responseText || "Failed to initialize session"),
        responseBody?.code,
      );
    }
  } catch (error) {
    if (attachmentsBound && attachmentIds.length > 0) {
      await attachmentService.unbindFromSession(attachmentIds, user.id, sessionId);
    }
    await sessionHistory.delete(sessionId);
    const details = error instanceof SessionInitializationError
      ? error.details
      : error instanceof Error
      ? error.message
      : "Unknown error";
    const status = error instanceof SessionInitializationError && error.status === 401
      ? 401
      : 500;
    const code = error instanceof SessionInitializationError ? error.code : undefined;
    const responseBody = {
      error: "Failed to create session",
      details,
      ...(code ? { code } : {}),
    };

    if (status === 401) {
      return c.json(responseBody, 401);
    }

    return c.json(responseBody, 500);
  }

  // If an initial message was provided, generate a title immediately
  let title: string | null = null;
  if (createSessionData.initialMessage) {
    try {
      title = await generateSessionTitle(c.env.ANTHROPIC_API_KEY, createSessionData.initialMessage);
      await sessionHistory.updateTitle(sessionId, title);
    } catch (error) {
      logger.error("Failed to generate title at creation", { error });
    }
  }

  const webSocketToken = await mintSessionWebSocketToken(
    c.env.WEBSOCKET_TOKEN_SIGNING_KEY,
    {
      sessionId,
      userId: user.id,
    },
  );

  return c.json({
    sessionId,
    title,
    websocketToken: webSocketToken.token,
    websocketTokenExpiresAt: webSocketToken.expiresAt,
  }, 201);
});

// Get session info
sessionsRoutes.openapi(getSessionRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const d1 = new Date();
  const authorized = await getAuthorizedSessionAgent(sessionId, user, c.env);
  logger.debug(`Fetched session agent in ${new Date().getTime() - d1.getTime()}ms`);
  if (!authorized.ok) {
    if (authorized.status === 403) {
      return c.json(authorized.body, 403);
    }
    return c.json(authorized.body, 404);
  }

  const d2 = new Date();
  const response = await authorized.stub.fetch(new Request("http://do/"));
  logger.debug(`Fetched session info in ${new Date().getTime() - d2.getTime()}ms`);
  if (!response.ok) {
    return c.json({ error: "Session not found" }, 404);
  }

  const session = SessionInfoResponse.parse(await response.json());
  return c.json(session, 200);
});

sessionsRoutes.openapi(createSessionWebSocketTokenRoute, async (c) => {
  const user = c.get("user");
  const { sessionId } = c.req.valid("param");
  logger.log(`creating session websocket token for ${sessionId}`);
  const sessionHistory = new SessionHistoryService(c.env.DB);
  const isOwnedByUser = await sessionHistory.isOwnedByUser(sessionId, user.id);

  if (!isOwnedByUser) {
    return c.json({ error: "Session not found" }, 404);
  }

  const webSocketToken = await mintSessionWebSocketToken(
    c.env.WEBSOCKET_TOKEN_SIGNING_KEY,
    {
      sessionId,
      userId: user.id,
    },
  );
  logger.log(`created session websocket token for ${sessionId}`);

  return c.json(webSocketToken, 200);
});

// Update session title
sessionsRoutes.openapi(updateSessionTitleRoute, async (c) => {
  const user = c.get("user");
  const { sessionId } = c.req.valid("param");
  const { title } = c.req.valid("json");
  const sessionHistory = new SessionHistoryService(c.env.DB);

  const isOwnedByUser = await sessionHistory.isOwnedByUser(sessionId, user.id);
  if (!isOwnedByUser) {
    return c.json({ error: "Session not found" }, 404);
  }

  await sessionHistory.updateTitle(sessionId, title);
  return c.json({ title }, 200);
});

// Get messages for a session
sessionsRoutes.openapi(getSessionMessagesRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const authorized = await getAuthorizedSessionAgent(sessionId, user, c.env);
  if (!authorized.ok) {
    if (authorized.status === 403) {
      return c.json(authorized.body, 403);
    }
    return c.json(authorized.body, 404);
  }

  const response = await authorized.stub.fetch(new Request("http://do/messages"));
  if (!response.ok) {
    return c.json({ error: "Failed to get messages" }, 500);
  }

  const messages = sessionMessagesResponseSchema.parse(await response.json());
  return c.json(messages, 200);
});

sessionsRoutes.openapi(getSessionPlanRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const authorized = await getAuthorizedSessionAgent(sessionId, user, c.env);
  if (!authorized.ok) {
    if (authorized.status === 403) {
      return c.json(authorized.body, 403);
    }
    return c.json(authorized.body, 404);
  }

  const response = await authorized.stub.fetch(new Request("http://do/plan"));
  if (response.status === 404) {
    return c.json({ error: "Plan not found" }, 404);
  }
  if (!response.ok) {
    return c.json({ error: "Failed to get plan" }, 500);
  }

  const plan = SessionPlanResponse.parse(await response.json());
  return c.json(plan, 200);
});

// Create a pull request for a session's pushed branch
sessionsRoutes.openapi(createPullRequestRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const authorized = await getAuthorizedSessionAgent(sessionId, user, c.env);
  if (!authorized.ok) {
    if (authorized.status === 403) {
      return c.json(authorized.body, 403);
    }
    return c.json(authorized.body, 404);
  }
  const github = new GitHubAppService(c.env, logger);
  try {
    const pullRequest = await createPullRequestForSession({
      sessionStub: authorized.stub,
      github,
      anthropicApiKey: c.env.ANTHROPIC_API_KEY,
    });
    return c.json(pullRequest, 201);
  } catch (error) {
    if (error instanceof SessionPullRequestServiceError) {
      if (error.status === 409 && error.responseBody.url) {
        return c.json(
          { error: error.responseBody.error, url: error.responseBody.url },
          409,
        );
      }
      if (error.status === 404) {
        return c.json({ error: error.responseBody.error }, 404);
      }
      if (error.status === 400) {
        return c.json(
          {
            error: error.responseBody.error,
            details: error.responseBody.details,
          },
          400,
        );
      }
      return c.json(
        { error: "Failed to create pull request" },
        400,
      );
    }
    throw error;
  }
});

// Check pull request status
sessionsRoutes.openapi(getPullRequestRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const authorized = await getAuthorizedSessionAgent(sessionId, user, c.env);
  if (!authorized.ok) {
    if (authorized.status === 403) {
      return c.json(authorized.body, 403);
    }
    return c.json(authorized.body, 404);
  }
  const github = new GitHubAppService(c.env, logger);
  try {
    const pullRequestStatus = await getPullRequestStatusForSession({
      sessionStub: authorized.stub,
      githubService: github,
    });
    return c.json(pullRequestStatus, 200);
  } catch (error) {
    if (error instanceof SessionPullRequestServiceError) {
      if (error.status === 404) {
        return c.json({ error: error.responseBody.error }, 404);
      }
      if (error.status === 400) {
        return c.json({ error: error.responseBody.error }, 400);
      }
      return c.json({ error: error.responseBody.error }, 500);
    }
    throw error;
  }
});

// Archive a session (hide from list but preserve data)
sessionsRoutes.openapi(archiveSessionRoute, async (c) => {
  const user = c.get("user");
  const { sessionId } = c.req.valid("param");
  const sessionHistory = new SessionHistoryService(c.env.DB);
  const isOwnedByUser = await sessionHistory.isOwnedByUser(sessionId, user.id);
  if (!isOwnedByUser) {
    return c.json({ error: "Session not found" }, 404);
  }
  await sessionHistory.archive(sessionId);
  return c.json({ archived: true as const }, 200);
});

// Delete a session
sessionsRoutes.openapi(deleteSessionRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const authorized = await getAuthorizedSessionAgent(sessionId, user, c.env);
  if (!authorized.ok) {
    if (authorized.status === 403) {
      return c.json(authorized.body, 403);
    }
    return c.json(authorized.body, 404);
  }

  const response = await authorized.stub.fetch(
    new Request("http://do/", { method: "DELETE" }),
  );

  if (!response.ok) {
    return c.json({ error: "Failed to delete session" }, 500);
  }

  // Hard-delete from D1 so terminated sessions vanish entirely.
  // Enqueue attachment object keys for async R2 cleanup as part of this bulk session deletion path.
  const sessionHistory = new SessionHistoryService(c.env.DB);
  await sessionHistory.deleteAndQueueAttachmentGc(sessionId);

  return c.json({ deleted: true as const }, 200);
});

// Open VS Code editor on the Sprite VM
sessionsRoutes.openapi(openEditorRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const authorized = await getAuthorizedSessionAgent(sessionId, user, c.env);
  if (!authorized.ok) {
    if (authorized.status === 403) {
      return c.json(authorized.body, 403);
    }
    return c.json(authorized.body, 404);
  }

  const response = await authorized.stub.fetch(
    new Request("http://do/editor/open", { method: "POST" }),
  );

  if (!response.ok) {
    const error = await response.text();
    if (response.status === 400) {
      return c.json({ error: "Failed to open editor", details: error }, 400);
    }
    return c.json({ error: "Failed to open editor", details: error }, 500);
  }

  const body = EditorOpenResponse.parse(await response.json());
  return c.json(body, 200);
});

// Close VS Code editor on the Sprite VM
sessionsRoutes.openapi(closeEditorRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const authorized = await getAuthorizedSessionAgent(sessionId, user, c.env);
  if (!authorized.ok) {
    if (authorized.status === 403) {
      return c.json(authorized.body, 403);
    }
    return c.json(authorized.body, 404);
  }

  const response = await authorized.stub.fetch(
    new Request("http://do/editor/close", { method: "POST" }),
  );

  if (!response.ok) {
    const error = await response.text();
    if (response.status === 400) {
      return c.json({ error: "Failed to close editor", details: error }, 400);
    }
    return c.json({ error: "Failed to close editor", details: error }, 500);
  }

  const body = EditorCloseResponse.parse(await response.json());
  return c.json(body, 200);
});
