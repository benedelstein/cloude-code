import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentByName } from "agents";
import { success } from "@repo/shared";
import type { Env } from "../../src/shared/types";
import type { InitSessionAgentRequest } from "../../src/shared/types/session-agent";
import { SessionsService } from "../../src/modules/sessions/services/sessions.service";

type PreparedStatement = {
  bind: (...values: unknown[]) => PreparedStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<void>;
};

function createSessionAccessRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    user_id: "user-1",
    repo_id: 42,
    installation_id: 456,
    repo_full_name: "owner/repo",
    provider_id: null,
    access_blocked_at: null,
    access_block_reason: null,
    ...overrides,
  };
}

function createSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    user_id: "user-1",
    repo_id: 42,
    installation_id: 456,
    repo_full_name: "owner/repo",
    title: "Fix the thing",
    archived: 0,
    access_blocked_at: null,
    access_block_reason: null,
    working_state: "idle",
    pushed_branch: "codex/fix-the-thing",
    pull_request_url: "https://github.com/owner/repo/pull/123",
    pull_request_number: 123,
    pull_request_state: "open",
    source_environment_id: null,
    source_environment_name: null,
    created_at: "2026-06-03 00:00:00",
    updated_at: "2026-06-03 00:00:01",
    last_message_at: "2026-06-03 00:00:02",
    last_assistant_message_id: "assistant-1",
    last_assistant_message_at: "2026-06-03 00:00:02",
    last_read_message_id: "assistant-1",
    last_read_at: "2026-06-03 00:00:03",
    ...overrides,
  };
}

function createMockDatabase(options: {
  firstRows?: unknown[];
} = {}) {
  const calls: Array<{ query: string; bindings: unknown[] }> = [];
  const firstRows = [...(options.firstRows ?? [])];
  const batch = vi.fn(async () => []);
  const database = {
    prepare(query: string): PreparedStatement {
      const call = { query, bindings: [] as unknown[] };
      calls.push(call);
      return {
        bind(...values: unknown[]) {
          call.bindings = values;
          return this;
        },
        async first<T>() {
          return (firstRows.shift() ?? null) as T | null;
        },
        async run() {},
      };
    },
    batch,
  } as D1Database;

  return { batch, calls, database };
}

function createService(database: D1Database) {
  const userSessionsStub = {
    createSessionSummary: vi.fn(async () => {}),
    invalidateSessionSummary: vi.fn(async () => {}),
    removeSessionSummary: vi.fn(async () => {}),
    requestResync: vi.fn(async () => {}),
  };
  const repoAccessProviders = {
    github: {
      findInstallationForRepoId: vi.fn(async () => success({ id: 456 })),
      getUserAccessibleInstallationRepoById: vi.fn(async () =>
        success({
          id: 42,
          fullName: "owner/repo",
          owner: "owner",
          name: "repo",
          defaultBranch: "main",
          private: true,
        })),
    },
    userTokens: {
      getValidGitHubCredentialByUserId: vi.fn(async () => success({ accessToken: "token" })),
      forceRefreshGitHubCredentialByUserId: vi.fn(async () => success({ accessToken: "token" })),
      getValidGitHubAccessTokenByUserId: vi.fn(async () => "token"),
      forceRefreshGitHubAccessTokenByUserId: vi.fn(async () => null),
    },
  };
  const service = new SessionsService({
    env: {
      DB: database,
      SESSION_AGENT: {},
      USER_SESSIONS: {
        getByName: vi.fn(() => userSessionsStub),
      },
      WEBSOCKET_TOKEN_SIGNING_KEY: "test-secret",
      ANTHROPIC_API_KEY: "anthropic-key",
    } as Env,
    attachmentProvider: {
      bindUnboundOwnedToSession: vi.fn(async () => true),
      unbindFromSession: vi.fn(async () => {}),
    },
    repoAccessProviders,
    repoEnvironmentResolver: {
      resolveEnvironmentSnapshot: vi.fn(async () =>
        success({
          sourceEnvironmentId: null,
          sourceEnvironmentName: null,
          repoId: 42,
          network: { mode: "unrestricted" },
          plainEnvVars: {},
          startupScript: null,
          resolvedAt: "2026-06-03T00:00:00.000Z",
          schemaVersion: 1,
        })),
    },
    createPullRequestGitHubProvider: vi.fn() as never,
  });
  return { service, userSessionsStub, repoAccessProviders };
}

describe("SessionsService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getAgentByName).mockReset();
  });

  it("fetches session metadata from D1 without repo access or a Durable Object call", async () => {
    const { calls, database } = createMockDatabase({
      firstRows: [createSessionRow()],
    });
    const { service, repoAccessProviders } = createService(database);

    const result = await service.getSession({
      sessionId: "session-1",
      userId: "user-1",
    });

    expect(result).toEqual(success({
      sessionId: "session-1",
      title: "Fix the thing",
      status: "ready",
      repoFullName: "owner/repo",
      pushedBranch: "codex/fix-the-thing",
      pullRequestUrl: "https://github.com/owner/repo/pull/123",
      pullRequestNumber: 123,
      pullRequestState: "open",
    }));
    expect(
      repoAccessProviders.github.getUserAccessibleInstallationRepoById,
    ).not.toHaveBeenCalled();
    expect(
      repoAccessProviders.userTokens.getValidGitHubAccessTokenByUserId,
    ).not.toHaveBeenCalled();
    expect(getAgentByName).not.toHaveBeenCalled();
    expect(calls).toEqual([
      expect.objectContaining({
        query: expect.stringContaining("SELECT * FROM sessions WHERE id = ? AND user_id = ?"),
        bindings: ["session-1", "user-1"],
      }),
    ]);
  });

  it("passes the required structured initial message to the session agent", async () => {
    const sessionId = "123e4567-e89b-12d3-a456-426614174000";
    const attachmentId = "123e4567-e89b-12d3-a456-426614174001";
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue(sessionId as ReturnType<typeof crypto.randomUUID>);
    const handleInit = vi.fn(async (_request: InitSessionAgentRequest) => success(undefined));
    vi.mocked(getAgentByName).mockResolvedValue({ handleInit } as never);
    const { calls, database } = createMockDatabase();
    const { service, userSessionsStub } = createService(database);

    try {
      const result = await service.createSession({
        userId: "123e4567-e89b-12d3-a456-426614174999",
        request: {
          repoId: 42,
          initialMessage: {
            attachmentIds: [attachmentId, attachmentId],
          },
        },
      });

      expect(result.ok).toBe(true);
      const insertSessionCall = calls.find((call) => call.query.includes("INSERT INTO sessions"));
      expect(insertSessionCall?.bindings).toEqual([
        sessionId,
        "123e4567-e89b-12d3-a456-426614174999",
        42,
        456,
        "owner/repo",
        "web",
        "claude-code",
        null,
        null,
      ]);
      expect(handleInit).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        userId: "123e4567-e89b-12d3-a456-426614174999",
        repoFullName: "owner/repo",
        agentSettings: { provider: "claude-code" },
        initialMessage: {
          attachmentIds: [attachmentId],
        },
      }));
      expect(userSessionsStub.createSessionSummary).toHaveBeenCalledWith({
        userId: "123e4567-e89b-12d3-a456-426614174999",
        sessionId,
      });
      expect(userSessionsStub.requestResync).not.toHaveBeenCalled();
    } finally {
      randomUuid.mockRestore();
    }
  });

  it("uses one explicit provider for the D1 row and session agent", async () => {
    const sessionId = "123e4567-e89b-12d3-a456-426614174000";
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValue(sessionId as ReturnType<typeof crypto.randomUUID>);
    const handleInit = vi.fn(async (_request: InitSessionAgentRequest) => success(undefined));
    vi.mocked(getAgentByName).mockResolvedValue({ handleInit } as never);
    const { calls, database } = createMockDatabase();
    const { service } = createService(database);

    const result = await service.createSession({
      userId: "123e4567-e89b-12d3-a456-426614174999",
      request: {
        repoId: 42,
        settings: { provider: "openai-codex", model: "gpt-5.5" },
        initialMessage: {
          attachmentIds: ["123e4567-e89b-12d3-a456-426614174001"],
        },
      },
    });

    expect(result.ok).toBe(true);
    const insertSessionCall = calls.find((call) => call.query.includes("INSERT INTO sessions"));
    expect(insertSessionCall?.bindings).toContain("openai-codex");
    expect(handleInit).toHaveBeenCalledWith(expect.objectContaining({
      agentSettings: { provider: "openai-codex", model: "gpt-5.5" },
    }));
  });

  it("deletes the D1 session row before cleaning up an already-destroyed session agent", async () => {
    const handleDeleteSession = vi.fn(async () => {
      throw new Error("destroyed");
    });
    vi.mocked(getAgentByName).mockResolvedValue({ handleDeleteSession } as never);
    const { batch, calls, database } = createMockDatabase({
      firstRows: [createSessionAccessRow()],
    });
    const { service, userSessionsStub } = createService(database);

    const result = await service.deleteSession({
      sessionId: "session-1",
      userId: "user-1",
    });

    expect(result).toEqual(success({ deleted: true }));
    expect(handleDeleteSession).toHaveBeenCalledTimes(1);
    expect(batch.mock.invocationCallOrder[0]).toBeLessThan(
      handleDeleteSession.mock.invocationCallOrder[0] ?? 0,
    );
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        query: expect.stringContaining("INSERT INTO attachment_gc_queue"),
        bindings: ["session-1"],
      }),
      expect.objectContaining({
        query: expect.stringContaining("DELETE FROM sessions WHERE id = ?"),
        bindings: ["session-1"],
      }),
    ]));
    expect(userSessionsStub.removeSessionSummary).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
    });
  });
});
