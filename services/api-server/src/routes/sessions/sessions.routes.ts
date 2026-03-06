import { OpenAPIHono } from "@hono/zod-openapi";
import type { SessionInfoResponse } from "@repo/shared";
import type { Env } from "@/types";
import { getAgentByName } from "agents";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import {
  GitHubAppService,
  GitHubAppError,
} from "@/lib/github";
import { logger } from "@/lib/logger";
import { SessionHistoryService } from "@/lib/session-history";
import {
  createPullRequestForSession,
  getPullRequestStatusForSession,
  SessionPullRequestServiceError,
} from "@/lib/session-pull-request-service";
import { generateSessionTitle } from "@/lib/generate-session-title";
import type { AuthUser } from "@/middleware/auth.middleware";
import {
  listSessionsRoute,
  createSessionRoute,
  getSessionRoute,
  updateSessionTitleRoute,
  getSessionMessagesRoute,
  createPullRequestRoute,
  getPullRequestRoute,
  archiveSessionRoute,
  deleteSessionRoute,
  openEditorRoute,
  closeEditorRoute,
} from "./routes";

export const sessionsRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

const getSessionAgent = async (id: string, env: Env) => {
  return await getAgentByName<Env, SessionAgentDO>(env.SESSION_AGENT, id);
};

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
  const parsed = c.req.valid("json");

  // Verify the GitHub App installation exists for this repo before creating the session
  const github = new GitHubAppService(c.env, logger);
  try {
    await github.findInstallationForRepo(
      ...parsed.repoFullName.split("/") as [string, string],
    );
  } catch (error) {
    if (error instanceof GitHubAppError) {
      return c.json({ error: error.message, code: error.code }, 422) as any;
    }
    throw error;
  }

  const user = c.get("user");
  const sessionId = crypto.randomUUID();
  console.log("creating session agent", sessionId, "user", user.githubLogin);
  const stub = await getSessionAgent(sessionId, c.env);

  // Initialize the session in the DO (token fetched internally by the DO)
  const initResponse = await stub.fetch(
    new Request("http://do/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        userId: user.id,
        repoFullName: parsed.repoFullName,
        settings: parsed.settings,
        branch: parsed.branch,
        initialMessage: parsed.initialMessage,
      }),
    }),
  );

  if (!initResponse.ok) {
    const error = await initResponse.text();
    return c.json(
      { error: "Failed to create session", details: error },
      500,
    ) as any;
  }

  // Record session in D1 for history listing
  const sessionHistory = new SessionHistoryService(c.env.DB);
  await sessionHistory.create({
    id: sessionId,
    userId: user.id,
    repoId: parsed.repoId,
    repoFullName: parsed.repoFullName,
  });

  // If an initial message was provided, generate a title immediately
  let title: string | null = null;
  if (parsed.initialMessage) {
    try {
      title = await generateSessionTitle(c.env.ANTHROPIC_API_KEY, parsed.initialMessage);
      await sessionHistory.updateTitle(sessionId, title);
    } catch (error) {
      console.error("Failed to generate title at creation:", error);
    }
  }

  return c.json({ sessionId, title }, 201);
});

// Get session info
sessionsRoutes.openapi(getSessionRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const stub = await getSessionAgent(sessionId, c.env);

  const response = await stub.fetch(new Request("http://do/"));
  if (!response.ok) {
    return c.json({ error: "Session not found" }, 404) as any;
  }

  const session = (await response.json()) as SessionInfoResponse;
  return c.json(session, 200);
});

// Update session title
sessionsRoutes.openapi(updateSessionTitleRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const { title } = c.req.valid("json");
  const sessionHistory = new SessionHistoryService(c.env.DB);

  const session = await sessionHistory.getById(sessionId);
  if (!session) {
    return c.json({ error: "Session not found" }, 404) as any;
  }

  await sessionHistory.updateTitle(sessionId, title);
  return c.json({ title }, 200);
});

// Get messages for a session
sessionsRoutes.openapi(getSessionMessagesRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const stub = await getSessionAgent(sessionId, c.env);

  const response = await stub.fetch(new Request("http://do/messages"));
  if (!response.ok) {
    return c.json({ error: "Failed to get messages" }, 500);
  }

  return c.json(await response.json(), 200);
});

// Create a pull request for a session's pushed branch
sessionsRoutes.openapi(createPullRequestRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const stub = await getSessionAgent(sessionId, c.env);
  const github = new GitHubAppService(c.env, logger);
  try {
    const pullRequest = await createPullRequestForSession({
      sessionStub: stub,
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
  const stub = await getSessionAgent(sessionId, c.env);
  const github = new GitHubAppService(c.env, logger);
  try {
    const pullRequestStatus = await getPullRequestStatusForSession({
      sessionStub: stub,
      github,
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
  const { sessionId } = c.req.valid("param");
  const sessionHistory = new SessionHistoryService(c.env.DB);
  await sessionHistory.archive(sessionId);
  return c.json({ archived: true as const }, 200);
});

// Delete a session
sessionsRoutes.openapi(deleteSessionRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const stub = await getSessionAgent(sessionId, c.env);

  const response = await stub.fetch(
    new Request("http://do/", { method: "DELETE" }),
  );

  if (!response.ok) {
    return c.json({ error: "Failed to delete session" }, 500);
  }

  // Hard-delete from D1 so terminated sessions vanish entirely
  const sessionHistory = new SessionHistoryService(c.env.DB);
  await sessionHistory.delete(sessionId);

  return c.json({ deleted: true as const }, 200);
});

// Open VS Code editor on the Sprite VM
sessionsRoutes.openapi(openEditorRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const stub = await getSessionAgent(sessionId, c.env);

  const response = await stub.fetch(
    new Request("http://do/editor/open", { method: "POST" }),
  );

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error: "Failed to open editor", details: error }, response.status as 500);
  }

  const body = (await response.json()) as { url: string; token: string };
  return c.json(body, 200);
});

// Close VS Code editor on the Sprite VM
sessionsRoutes.openapi(closeEditorRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const stub = await getSessionAgent(sessionId, c.env);

  const response = await stub.fetch(
    new Request("http://do/editor/close", { method: "POST" }),
  );

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error: "Failed to close editor", details: error }, response.status as 500);
  }

  const body = (await response.json()) as { closed: true };
  return c.json(body, 200);
});
