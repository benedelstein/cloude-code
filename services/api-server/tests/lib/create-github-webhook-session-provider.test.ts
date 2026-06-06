import { afterEach, describe, expect, it, vi } from "vitest";
import { failure, success } from "@repo/shared";
import { createGitHubWebhookSessionProvider } from "../../src/composition/providers/create-github-webhook-session-provider";
import type { Env } from "../../src/shared/types";
import type { SessionAgentRpc } from "../../src/shared/types/session-agent";

type PreparedStatement = {
  bind: (...values: unknown[]) => PreparedStatement;
  all: <T>() => Promise<{ results: T[] }>;
};

function createMockDatabase(rows: Array<{ id: string; user_id: string }>) {
  const calls: Array<{ query: string; bindings: unknown[] }> = [];
  const database = {
    prepare(query: string): PreparedStatement {
      const call = { query, bindings: [] as unknown[] };
      calls.push(call);
      return {
        bind(...values: unknown[]) {
          call.bindings = values;
          return this;
        },
        async all<T>() {
          return { results: rows as T[] };
        },
      };
    },
  } as D1Database;

  return { database, calls };
}

function createEnv(params: {
  database: D1Database;
  userSessionsGetByName?: ReturnType<typeof vi.fn>;
}): Env {
  return {
    DB: params.database,
    SESSION_AGENT: {
      getByName: vi.fn(),
    },
    USER_SESSIONS: {
      getByName: params.userSessionsGetByName ?? vi.fn(),
    },
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: "cHJpdmF0ZS1rZXk=",
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_APP_CLIENT_ID: "client-id",
    GITHUB_APP_CLIENT_SECRET: "client-secret",
    GITHUB_APP_SLUG: "cloude-code",
    TOKEN_ENCRYPTION_KEY: "token-key",
  } as unknown as Env;
}

describe("createGitHubWebhookSessionProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes pull request webhook state updates through each session agent", async () => {
    const { database, calls } = createMockDatabase([
      { id: "session-a", user_id: "user-a" },
      { id: "session-b", user_id: "user-b" },
    ]);
    const userSessionsGetByName = vi.fn();
    const updateSessionA = vi.fn(async () => success(undefined));
    const updateSessionB = vi.fn(async () => success(undefined));
    const sessionAgents: Record<string, Pick<SessionAgentRpc, "updatePullRequest">> = {
      "session-a": { updatePullRequest: updateSessionA },
      "session-b": { updatePullRequest: updateSessionB },
    };
    const env = createEnv({ database, userSessionsGetByName });
    vi.mocked(env.SESSION_AGENT.getByName).mockImplementation((sessionId) =>
      sessionAgents[String(sessionId)] as never
    );
    const provider = createGitHubWebhookSessionProvider(env);

    await provider.updatePullRequestFromWebhook({
      installationId: 10,
      repoId: 20,
      number: 30,
      state: "merged",
    });

    expect(calls[0]?.query).toContain("SELECT id, user_id");
    expect(calls[0]?.query).not.toContain("UPDATE sessions");
    expect(calls[0]?.bindings).toEqual([10, 20, 30]);
    expect(env.SESSION_AGENT.getByName).toHaveBeenCalledTimes(2);
    expect(env.SESSION_AGENT.getByName).toHaveBeenCalledWith("session-a");
    expect(env.SESSION_AGENT.getByName).toHaveBeenCalledWith("session-b");
    expect(updateSessionA).toHaveBeenCalledWith({ state: "merged" });
    expect(updateSessionB).toHaveBeenCalledWith({ state: "merged" });
    expect(userSessionsGetByName).not.toHaveBeenCalled();
  });

  it("does not fall back to direct sidebar publishing when a session agent has no PR", async () => {
    const { database, calls } = createMockDatabase([
      { id: "session-a", user_id: "user-a" },
    ]);
    const userSessionsGetByName = vi.fn();
    const updatePullRequest = vi.fn(async () =>
      failure({
        code: "PULL_REQUEST_NOT_FOUND",
        message: "Pull request not found",
      })
    );
    const env = createEnv({ database, userSessionsGetByName });
    vi.mocked(env.SESSION_AGENT.getByName).mockReturnValue({ updatePullRequest } as never);
    const provider = createGitHubWebhookSessionProvider(env);

    await expect(provider.updatePullRequestFromWebhook({
      installationId: 10,
      repoId: 20,
      number: 30,
      state: "closed",
    })).resolves.toBeUndefined();

    expect(calls[0]?.query).not.toContain("UPDATE sessions");
    expect(updatePullRequest).toHaveBeenCalledWith({ state: "closed" });
    expect(userSessionsGetByName).not.toHaveBeenCalled();
  });
});
