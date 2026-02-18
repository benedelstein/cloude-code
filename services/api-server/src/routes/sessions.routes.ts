import { Hono } from "hono";
import { CreateSessionRequest, type SessionInfoResponse, type ListSessionsResponse } from "@repo/shared";
import type { Env } from "../types";
import { getAgentByName } from "agents";
import type { SessionAgentDO } from "../durable-objects/session-agent-do";
import { GitHubAppService, GitHubAppError } from "@/lib/github";
import { SessionHistoryService } from "@/lib/session-history";
import type { AuthUser } from "@/middleware/auth.middleware";

export const sessionsRoutes = new Hono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

const getSessionAgent = async (id: string, env: Env) => {
  // Use getAgentByName to properly route requests (including WebSockets)
  // This adds the headers that PartyServer/Agents SDK expects
  return await getAgentByName<Env, SessionAgentDO>(env.SESSION_AGENT, id);
};

// List sessions for the current user
sessionsRoutes.get("/", async (c) => {
  const user = c.get("user");
  const repoId = c.req.query("repoId");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  const cursor = c.req.query("cursor");

  const sessionHistory = new SessionHistoryService(c.env.DB);
  const result = await sessionHistory.listByUser(user.id, {
    repoId,
    limit,
    cursor: cursor ?? undefined,
  });

  return c.json(result satisfies ListSessionsResponse);
});

// Create a new session
sessionsRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateSessionRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  // Verify the GitHub App installation exists for this repo before creating the session
  const github = new GitHubAppService(c.env);
  try {
    await github.findInstallationForRepo(
      ...parsed.data.repoId.split("/") as [string, string],
    );
  } catch (error) {
    if (error instanceof GitHubAppError) {
      return c.json({ error: error.message, code: error.code }, 422);
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
        repoId: parsed.data.repoId,
        settings: parsed.data.settings,
      }),
    })
  );

  if (!initResponse.ok) {
    const error = await initResponse.text();
    return c.json({ error: "Failed to create session", details: error }, 500);
  }

  // Record session in D1 for history listing
  const sessionHistory = new SessionHistoryService(c.env.DB);
  await sessionHistory.create({
    id: sessionId,
    userId: user.id,
    repoId: parsed.data.repoId,
  });

  return c.json({ sessionId }, 201);
});

// Get session info
sessionsRoutes.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getSessionAgent(sessionId, c.env);

  const response = await stub.fetch(new Request("http://do/"));
  if (!response.ok) {
    return c.json({ error: "Session not found" }, 404);
  }

  const session = (await response.json()) as SessionInfoResponse;
  return c.json(session);
});

// Get messages for a session
sessionsRoutes.get("/:sessionId/messages", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getSessionAgent(sessionId, c.env);

  const response = await stub.fetch(new Request("http://do/messages"));
  if (!response.ok) {
    return c.json({ error: "Failed to get messages" }, 500);
  }

  return c.json(await response.json());
});

// Create a pull request for a session's pushed branch
sessionsRoutes.post("/:sessionId/pr", async (c) => {
  const sessionId = c.req.param("sessionId");
  const user = c.get("user");
  const stub = await getSessionAgent(sessionId, c.env);

  // Get session info (repoId, pushedBranch) from the DO
  const sessionResponse = await stub.fetch(new Request("http://do/"));
  if (!sessionResponse.ok) {
    return c.json({ error: "Session not found" }, 404);
  }
  const session = (await sessionResponse.json()) as SessionInfoResponse;

  if (!session.pushedBranch) {
    return c.json({ error: "No branch has been pushed yet" }, 400);
  }

  if (session.pullRequestUrl) {
    return c.json({ error: "Pull request already exists", url: session.pullRequestUrl }, 409);
  }

  const [owner, repo] = session.repoId.split("/");
  if (!owner || !repo) {
    return c.json({ error: "Invalid repoId" }, 400);
  }

  // Generate PR title from branch name (e.g. "cloude/fix-readme-a1b2" -> "fix readme")
  const branchName = session.pushedBranch;
  const titleSlug = branchName
    .replace(/^cloude\//, "")
    .replace(/-[a-z0-9]{4}$/, "")
    .replace(/-/g, " ");
  const title = titleSlug.charAt(0).toUpperCase() + titleSlug.slice(1);

  // Create PR using user's GitHub OAuth token
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${user.githubAccessToken}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "cloude-code",
    },
    body: JSON.stringify({
      title,
      head: branchName,
      base: "main",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`GitHub PR creation failed: ${response.status} ${errorBody}`);
    return c.json({ error: "Failed to create pull request", details: errorBody }, response.status as 400);
  }

  const prData = await response.json() as { html_url: string; number: number; state: string };

  // Store PR info in the DO
  await stub.fetch(new Request("http://do/pr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: prData.html_url,
      number: prData.number,
      state: "open",
    }),
  }));

  return c.json({
    url: prData.html_url,
    number: prData.number,
    state: "open",
  }, 201);
});

// Check pull request status
sessionsRoutes.get("/:sessionId/pr", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getSessionAgent(sessionId, c.env);

  const sessionResponse = await stub.fetch(new Request("http://do/"));
  if (!sessionResponse.ok) {
    return c.json({ error: "Session not found" }, 404);
  }
  const session = (await sessionResponse.json()) as SessionInfoResponse;

  if (!session.pullRequestNumber || !session.pullRequestUrl) {
    return c.json({ error: "No pull request exists" }, 404);
  }

  const [owner, repo] = session.repoId.split("/");
  if (!owner || !repo) {
    return c.json({ error: "Invalid repoId" }, 400);
  }

  // Use installation token for reads (no user token needed)
  const github = new GitHubAppService(c.env);
  const installationToken = await github.getTokenForRepo(session.repoId);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${session.pullRequestNumber}`,
    {
      headers: {
        "Authorization": `Bearer ${installationToken}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "cloude-code",
      },
    },
  );

  if (!response.ok) {
    return c.json({ error: "Failed to fetch PR status" }, 500);
  }

  const prData = await response.json() as { state: string; merged: boolean };
  const state = prData.merged ? "merged" : prData.state as "open" | "closed";

  // Update DO state if changed
  if (state !== session.pullRequestState) {
    await stub.fetch(new Request("http://do/pr", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    }));
  }

  return c.json({
    url: session.pullRequestUrl,
    number: session.pullRequestNumber,
    state,
    merged: prData.merged,
  });
});

// Delete a session
sessionsRoutes.delete("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const stub = await getSessionAgent(sessionId, c.env);

  const response = await stub.fetch(
    new Request("http://do/", { method: "DELETE" })
  );

  if (!response.ok) {
    return c.json({ error: "Failed to delete session" }, 500);
  }

  // Archive in D1 (keep the record for history visibility)
  const sessionHistory = new SessionHistoryService(c.env.DB);
  await sessionHistory.archive(sessionId);

  return c.json({ deleted: true });
});
