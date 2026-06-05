import { describe, expect, it } from "vitest";
import { SessionsRepository } from "../../src/modules/sessions/repositories/sessions.repository";
import {
  decodeRepoCursor,
  decodeSessionCursor,
  encodeSessionCursor,
} from "../../src/modules/sessions/repositories/sessions-cursors.repository";

type PreparedStatement = {
  bind: (...values: unknown[]) => PreparedStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<void>;
};

function createSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    user_id: "user-1",
    repo_id: 1,
    installation_id: 10,
    repo_full_name: "owner/repo",
    title: "Sidebar work",
    archived: 0,
    access_blocked_at: null,
    access_block_reason: null,
    working_state: "idle",
    pushed_branch: null,
    pull_request_url: null,
    pull_request_number: null,
    pull_request_state: null,
    source_environment_id: null,
    source_environment_name: null,
    created_at: "2026-05-24 10:00:00",
    updated_at: "2026-05-24 10:01:00",
    last_message_at: "2026-05-24 10:02:00",
    ...overrides,
  };
}

function createMockDatabase(options: {
  firstRow?: unknown;
  allRows?: unknown[][];
} = {}) {
  const calls: Array<{ query: string; bindings: unknown[] }> = [];
  const allRowsQueue = [...(options.allRows ?? [])];
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
          return options.firstRow as T | null;
        },
        async all<T>() {
          return { results: (allRowsQueue.shift() ?? []) as T[] };
        },
        async run() {},
      };
    },
  } as D1Database;

  return { database, calls };
}

describe("SessionsRepository sidebar state", () => {
  it("maps sidebar summary columns from D1 rows", async () => {
    const { database } = createMockDatabase({
      firstRow: createSessionRow({
        working_state: "responding",
        pushed_branch: "cloude/sidebar-abcd",
        pull_request_url: "https://github.com/owner/repo/pull/4",
        pull_request_number: 4,
        pull_request_state: "open",
      }),
    });

    const repository = new SessionsRepository(database);

    await expect(repository.getById("123e4567-e89b-12d3-a456-426614174000"))
      .resolves.toMatchObject({
        workingState: "responding",
        pushedBranch: "cloude/sidebar-abcd",
        pullRequest: {
          url: "https://github.com/owner/repo/pull/4",
          number: 4,
          state: "open",
        },
        createdAt: "2026-05-24T10:00:00Z",
      });
  });

  it("fetches summaries by both session id and user id", async () => {
    const { database, calls } = createMockDatabase({
      firstRow: createSessionRow({ id: "session-1", user_id: "user-1" }),
    });
    const repository = new SessionsRepository(database);

    await expect(repository.getByIdForUser("session-1", "user-1"))
      .resolves.toMatchObject({ id: "session-1" });

    expect(calls[0]?.query).toContain("WHERE id = ? AND user_id = ?");
    expect(calls[0]?.bindings).toEqual(["session-1", "user-1"]);
  });

  it("updates PR state by installation, repo, and PR number for webhooks", async () => {
    const { database, calls } = createMockDatabase({
      allRows: [[
        { id: "session-a", user_id: "user-a" },
        { id: "session-b", user_id: "user-b" },
      ]],
    });
    const repository = new SessionsRepository(database);

    const invalidated = await repository.updatePullRequestFromWebhook({
      installationId: 10,
      repoId: 20,
      number: 30,
      url: "https://github.com/owner/repo/pull/30",
      state: "merged",
    });

    expect(calls[0]?.bindings).toEqual([
      "https://github.com/owner/repo/pull/30",
      30,
      "merged",
      10,
      20,
      30,
    ]);
    expect(calls[0]?.query).toContain("RETURNING id, user_id");
    expect(invalidated).toEqual([
      { id: "session-a", userId: "user-a" },
      { id: "session-b", userId: "user-b" },
    ]);
  });

  it("groups sessions by newest creation time without using updated_at ordering", async () => {
    const { database, calls } = createMockDatabase({
      allRows: [
        [
          { repo_id: 2, max_created_at: "2026-05-24 12:00:00" },
          { repo_id: 1, max_created_at: "2026-05-23 12:00:00" },
        ],
        [
          createSessionRow({
            id: "session-new",
            repo_id: 2,
            repo_full_name: "owner/new",
            created_at: "2026-05-24 12:00:00",
            updated_at: "2026-05-25 12:00:00",
            working_state: "responding",
          }),
          createSessionRow({
            id: "session-older",
            repo_id: 2,
            repo_full_name: "owner/new",
            created_at: "2026-05-23 12:00:00",
            updated_at: "2026-05-26 12:00:00",
          }),
        ],
      ],
    });
    const repository = new SessionsRepository(database);

    const page = await repository.listGroupedByUser("user-1", {
      repoLimit: 1,
      sessionLimit: 1,
    });

    expect(calls[0]?.query).toContain("MAX(created_at) AS max_created_at");
    expect(calls[0]?.query).toContain("ORDER BY max_created_at DESC, repo_id DESC");
    expect(calls[0]?.query).not.toContain("updated_at");
    expect(calls[1]?.query).toContain("ORDER BY created_at DESC, id DESC");
    expect(calls[1]?.query).not.toContain("ORDER BY updated_at");
    expect(page.groups).toHaveLength(1);
    expect(page.groups[0]?.sessions[0]).toMatchObject({
      id: "session-new",
      workingState: "responding",
    });
    expect(decodeRepoCursor(page.nextRepoCursor ?? "")).toEqual({
      maxCreatedAt: "2026-05-24 12:00:00",
      repoId: 2,
    });
    expect(decodeSessionCursor(page.groups[0]?.nextSessionCursor ?? "")).toEqual({
      createdAt: "2026-05-24 12:00:00",
      sessionId: "session-new",
    });
  });

  it("paginates a single repo by created_at cursor", async () => {
    const cursor = encodeSessionCursor({
      createdAt: "2026-05-24 12:00:00",
      sessionId: "session-new",
    });
    const { database, calls } = createMockDatabase({
      allRows: [[
        createSessionRow({
          id: "session-older",
          repo_id: 2,
          created_at: "2026-05-23 12:00:00",
        }),
      ]],
    });
    const repository = new SessionsRepository(database);

    await repository.listSessionsForRepo("user-1", 2, {
      sessionCursor: cursor,
      sessionLimit: 5,
    });

    expect(calls[0]?.query).toContain("created_at < ?");
    expect(calls[0]?.query).toContain("ORDER BY created_at DESC, id DESC");
    expect(calls[0]?.query).not.toContain("updated_at <");
    expect(calls[0]?.bindings).toEqual([
      "user-1",
      2,
      "2026-05-24 12:00:00",
      "2026-05-24 12:00:00",
      "session-new",
      6,
    ]);
  });
});
