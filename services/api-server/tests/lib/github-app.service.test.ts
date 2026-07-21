import { describe, expect, it } from "vitest";
import type { Logger } from "@repo/shared";
import { GitHubAppService } from "../../src/modules/github/services/github-app.service";
import type { Env } from "../../src/shared/types";

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

function createDatabase(currentInstallationId: number): D1Database {
  return {
    prepare(query: string) {
      expect(query).toContain("github_user_repo_access_cache");
      return {
        bind(userId: string, repoId: number) {
          expect(userId).toBe("user-1");
          expect(repoId).toBe(365851433);
          return this;
        },
        async first<T>() {
          return { installation_id: currentInstallationId } as T;
        },
      };
    },
  } as unknown as D1Database;
}

function createEnv(database: D1Database): Env {
  return {
    DB: database,
    GITHUB_APP_ID: "2992869",
    GITHUB_APP_PRIVATE_KEY: btoa("private-key"),
    GITHUB_WEBHOOK_SECRET: "webhook-secret",
    GITHUB_APP_CLIENT_ID: "client-id",
    GITHUB_APP_CLIENT_SECRET: "client-secret",
    GITHUB_APP_SLUG: "cloude-code-local",
    TOKEN_ENCRYPTION_KEY: "token-encryption-key",
  } as Env;
}

describe("GitHubAppService", () => {
  it("prefers the user's current installation over stale global repo mappings", async () => {
    const currentInstallationId = 147944633;
    const service = new GitHubAppService(
      createEnv(createDatabase(currentInstallationId)),
      createLogger(),
    );

    await expect(service.findInstallationForRepoId(
      "user-1",
      365851433,
      "user-token",
    )).resolves.toEqual({
      ok: true,
      value: { id: currentInstallationId },
    });
  });
});
