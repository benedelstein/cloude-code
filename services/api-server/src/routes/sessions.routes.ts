import { Hono } from "hono";
import { CreateSessionRequest, type SessionInfoResponse } from "@repo/shared";
import type { Env } from "../types";
import { getAgentByName } from "agents";
import type { SessionAgentDO } from "../durable-objects/session-agent-do";
import { GitHubAppService, GitHubAppError } from "@/lib/github";
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
        userId: user.id,
        settings: parsed.data.settings,
      }),
    })
  );

  if (!initResponse.ok) {
    const error = await initResponse.text();
    return c.json({ error: "Failed to create session", details: error }, 500);
  }

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

  return c.json({ deleted: true });
});
