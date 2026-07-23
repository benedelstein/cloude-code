import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@repo/shared";
import { GitHubAppService } from "../../src/modules/github/services/github-app.service";
import type { Env } from "../../src/shared/types";

const octokitState = vi.hoisted(() => ({
  createInstallationAccessToken: vi.fn(),
  getInstallationOctokit: vi.fn(),
}));

vi.mock("octokit", () => ({
  App: vi.fn(() => ({
    getInstallationOctokit: octokitState.getInstallationOctokit,
    oauth: {
      createToken: vi.fn(),
      refreshToken: vi.fn(),
    },
    webhooks: {
      on: vi.fn(),
      verifyAndReceive: vi.fn(),
    },
  })),
  Octokit: vi.fn(),
}));

function createLogger(): Logger {
  return {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    scope() {
      return this;
    },
  };
}

function createEnv(database: D1Database): Env {
  return {
    DB: database,
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: btoa("private-key"),
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_APP_CLIENT_ID: "client-id",
    GITHUB_APP_CLIENT_SECRET: "client-secret",
    GITHUB_APP_SLUG: "my-machines-integration",
    TOKEN_ENCRYPTION_KEY: btoa("12345678901234567890123456789012"),
  } as Env;
}

function createDatabase(cachedRow: { token: string; expires_at: string } | null) {
  const prepared: Array<{ sql: string; bindings: unknown[] }> = [];
  const database = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => {
        prepared.push({ sql, bindings });
        return {
          first: vi.fn(async () => cachedRow),
          run: vi.fn(async () => ({ success: true })),
        };
      }),
    })),
  } as unknown as D1Database;

  return { database, prepared };
}

describe("GitHubAppService installation token cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    octokitState.getInstallationOctokit.mockResolvedValue({
      rest: {
        apps: {
          createInstallationAccessToken: octokitState.createInstallationAccessToken,
        },
      },
    });
    octokitState.createInstallationAccessToken.mockResolvedValue({
      data: {
        token: "fresh-token",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    });
  });

  it("uses a valid D1 cached installation token without refreshing", async () => {
    const { database, prepared } = createDatabase({
      token: "cached-token",
      expires_at: "2099-01-01T00:00:00.000Z",
    });
    const service = new GitHubAppService(createEnv(database), createLogger());

    await expect(service.getInstallationToken(2, {
      repoName: "repo",
      repoId: 10,
    })).resolves.toBe("cached-token");

    expect(octokitState.createInstallationAccessToken).not.toHaveBeenCalled();
    expect(prepared[0]?.sql).toContain("datetime(expires_at) > datetime('now', '+5 minutes')");
  });

  it("refreshes and stores a missing or stale installation token", async () => {
    const { database, prepared } = createDatabase(null);
    const service = new GitHubAppService(createEnv(database), createLogger());

    await expect(service.getInstallationToken(2, {
      repoName: "repo",
      repoId: 10,
    })).resolves.toBe("fresh-token");

    expect(octokitState.createInstallationAccessToken).toHaveBeenCalledWith({
      installation_id: 2,
      repositories: ["repo"],
      permissions: { contents: "write", metadata: "read" },
    });
    expect(prepared.some((entry) =>
      entry.sql.includes("INSERT OR REPLACE INTO installation_token_cache")
      && entry.bindings[0] === 2
      && entry.bindings[1] === "10",
    )).toBe(true);
  });
});
