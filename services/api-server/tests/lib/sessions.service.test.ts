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

function createMockDatabase() {
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
        async first<T>() {
          return null as T | null;
        },
        async run() {},
      };
    },
  } as D1Database;

  return { calls, database };
}

function createService(database: D1Database) {
  const userSessionsStub = {
    createSessionSummary: vi.fn(async () => {}),
    requestResync: vi.fn(async () => {}),
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
    repoAccessProviders: {
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
        getValidGitHubAccessTokenByUserId: vi.fn(async () => "token"),
        forceRefreshGitHubAccessTokenByUserId: vi.fn(async () => null),
      },
    },
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
  return { service, userSessionsStub };
}

describe("SessionsService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getAgentByName).mockReset();
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
        githubAccessToken: "token",
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
        null,
        null,
      ]);
      expect(handleInit).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        userId: "123e4567-e89b-12d3-a456-426614174999",
        repoFullName: "owner/repo",
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
});
