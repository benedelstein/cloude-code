import { describe, expect, it } from "vitest";
import { SessionsRepository } from "../../src/modules/sessions/repositories/sessions.repository";

type PreparedStatement = {
  bind: (...values: unknown[]) => PreparedStatement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<void>;
};

function createMockDatabase(row: unknown = null) {
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
          return row as T | null;
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
      id: "123e4567-e89b-12d3-a456-426614174000",
      user_id: "user-1",
      repo_id: 1,
      installation_id: 10,
      repo_full_name: "owner/repo",
      title: "Sidebar work",
      archived: 0,
      access_blocked_at: null,
      access_block_reason: null,
      working_state: "responding",
      pushed_branch: "cloude/sidebar-abcd",
      pull_request_url: "https://github.com/owner/repo/pull/4",
      pull_request_number: 4,
      pull_request_state: "open",
      created_at: "2026-05-24 10:00:00",
      updated_at: "2026-05-24 10:01:00",
      last_message_at: "2026-05-24 10:02:00",
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

  it("updates PR state by installation, repo, and PR number for webhooks", async () => {
    const { database, calls } = createMockDatabase();
    const repository = new SessionsRepository(database);

    await repository.updatePullRequestFromWebhook({
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
  });
});
