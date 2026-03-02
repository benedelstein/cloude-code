import { OpenAPIHono } from "@hono/zod-openapi";
import type { SessionInfoResponse } from "@repo/shared";
import type { Env } from "@/types";
import { getAgentByName } from "agents";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import { GitHubAppService, GitHubAppError } from "@/lib/github";
import { SessionHistoryService } from "@/lib/session-history";
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
  const github = new GitHubAppService(c.env);
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
    return c.json({ error: "Failed to get messages" }, 500) as any;
  }

  return c.json(await response.json() as any, 200);
});

// Create a pull request for a session's pushed branch
sessionsRoutes.openapi(createPullRequestRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const user = c.get("user");
  const stub = await getSessionAgent(sessionId, c.env);

  // Get session info (repoFullName, pushedBranch) from the DO
  const sessionResponse = await stub.fetch(new Request("http://do/"));
  if (!sessionResponse.ok) {
    return c.json({ error: "Session not found" }, 404) as any;
  }
  const session = (await sessionResponse.json()) as SessionInfoResponse;

  if (!session.pushedBranch) {
    return c.json({ error: "No branch has been pushed yet" }, 400) as any;
  }

  if (session.pullRequestUrl) {
    return c.json(
      { error: "Pull request already exists", url: session.pullRequestUrl },
      409,
    ) as any;
  }

  const [owner, repo] = session.repoFullName.split("/");
  if (!owner || !repo) {
    return c.json({ error: "Invalid repoFullName" }, 400) as any;
  }

  // Generate PR title from branch name (e.g. "cloude/fix-readme-a1b2" -> "fix readme")
  const branchName = session.pushedBranch;
  const titleSlug = branchName
    .replace(/^cloude\//, "")
    .replace(/-[a-z0-9]{4}$/, "")
    .replace(/-/g, " ");
  const title = titleSlug.charAt(0).toUpperCase() + titleSlug.slice(1);

  const baseBranch = session.baseBranch ?? "main";

  // Create PR using user's GitHub OAuth token
  const prResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.githubAccessToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "cloude-code",
      },
      body: JSON.stringify({
        title,
        head: branchName,
        base: baseBranch,
      }),
    },
  );

  if (!prResponse.ok) {
    const errorBody = await prResponse.text();
    console.error(
      `GitHub PR creation failed: ${prResponse.status} ${errorBody}`,
    );
    return c.json(
      { error: "Failed to create pull request", details: errorBody },
      prResponse.status as 400,
    ) as any;
  }

  const prData = (await prResponse.json()) as {
    html_url: string;
    number: number;
    state: string;
  };

  // Store PR info in the DO
  await stub.fetch(
    new Request("http://do/pr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: prData.html_url,
        number: prData.number,
        state: "open",
      }),
    }),
  );

  return c.json(
    {
      url: prData.html_url,
      number: prData.number,
      state: "open",
    },
    201,
  );
});

// Check pull request status
sessionsRoutes.openapi(getPullRequestRoute, async (c) => {
  const { sessionId } = c.req.valid("param");
  const stub = await getSessionAgent(sessionId, c.env);

  const sessionResponse = await stub.fetch(new Request("http://do/"));
  if (!sessionResponse.ok) {
    return c.json({ error: "Session not found" }, 404) as any;
  }
  const session = (await sessionResponse.json()) as SessionInfoResponse;

  if (!session.pullRequestNumber || !session.pullRequestUrl) {
    return c.json({ error: "No pull request exists" }, 404) as any;
  }

  const [owner, repo] = session.repoFullName.split("/");
  if (!owner || !repo) {
    return c.json({ error: "Invalid repoFullName" }, 400) as any;
  }

  // Use installation token for reads (no user token needed)
  const github = new GitHubAppService(c.env);
  const installationToken = await github.getTokenForRepo(
    session.repoFullName,
  );

  const prResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${session.pullRequestNumber}`,
    {
      headers: {
        Authorization: `Bearer ${installationToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cloude-code",
      },
    },
  );

  if (!prResponse.ok) {
    return c.json({ error: "Failed to fetch PR status" }, 500) as any;
  }

  const prData = (await prResponse.json()) as {
    state: string;
    merged: boolean;
  };
  const state = prData.merged
    ? "merged"
    : (prData.state as "open" | "closed");

  // Update DO state if changed
  if (state !== session.pullRequestState) {
    await stub.fetch(
      new Request("http://do/pr", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    );
  }

  return c.json(
    {
      url: session.pullRequestUrl,
      number: session.pullRequestNumber,
      state,
      merged: prData.merged,
    },
    200,
  );
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
    return c.json({ error: "Failed to delete session" }, 500) as any;
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
    return c.json({ error: "Failed to open editor", details: error }, response.status as 500) as any;
  }

  return c.json(await response.json() as any, 200);
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
    return c.json({ error: "Failed to close editor", details: error }, response.status as 500) as any;
  }

  return c.json(await response.json() as any, 200);
});
