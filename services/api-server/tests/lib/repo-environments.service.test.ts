import { beforeEach, describe, expect, it, vi } from "vitest";
import { success, failure } from "@repo/shared";
import { RepoEnvironmentsService } from "../../src/modules/repo-environments/services/repo-environments.service";
import type { Env } from "../../src/shared/types";

type Row = {
  id: string;
  user_id: string;
  repo_id: number;
  repo_full_name: string | null;
  name: string;
  network_mode: string;
  network_extra_allowlist_json: string;
  network_include_default_allowlist?: number | null;
  plain_env_vars_json: string;
  startup_script: string | null;
  created_at: string;
  updated_at: string;
};

function createDatabase(
  rows: Row[] = [],
  options: { failReadsForIds?: Set<string> } = {},
) {
  const database = {
    prepare(query: string) {
      const call = { bindings: [] as unknown[] };
      return {
        bind(...values: unknown[]) {
          call.bindings = values;
          return this;
        },
        async all<T>() {
          const [_userId, repoId] = call.bindings;
          if (repoId === undefined) {
            return {
              results: rows.filter((row) => row.user_id === _userId) as T[],
            };
          }
          return {
            results: rows.filter((row) =>
              row.user_id === _userId && row.repo_id === repoId,
            ) as T[],
          };
        },
        async first<T>() {
          const [id, userId, repoId] = call.bindings;
          if (typeof id === "string" && options.failReadsForIds?.has(id)) {
            return null;
          }
          if (repoId === undefined) {
            return (rows.find((row) =>
              row.id === id && row.user_id === userId,
            ) ?? null) as T | null;
          }
          return (rows.find((row) =>
            row.id === id && row.user_id === userId && row.repo_id === repoId,
          ) ?? null) as T | null;
        },
        async run() {
          if (query.includes("INSERT INTO repo_environments")) {
            const [
              id,
              userId,
              repoId,
              repoFullName,
              name,
              networkMode,
              extraAllowlistJson,
              includeDefaultAllowlist,
              plainEnvVarsJson,
              startupScript,
            ] = call.bindings as [
              string,
              string,
              number,
              string,
              string,
              string,
              string,
              number,
              string,
              string | null,
            ];
            if (rows.some((row) =>
              row.user_id === userId && row.repo_id === repoId && row.name === name,
            )) {
              return { meta: { changes: 0 } };
            }
            rows.push({
              id,
              user_id: userId,
              repo_id: repoId,
              repo_full_name: repoFullName,
              name,
              network_mode: networkMode,
              network_extra_allowlist_json: extraAllowlistJson,
              network_include_default_allowlist: includeDefaultAllowlist,
              plain_env_vars_json: plainEnvVarsJson,
              startup_script: startupScript,
              created_at: "2026-05-29 00:00:00",
              updated_at: "2026-05-29 00:00:00",
            });
            return { meta: { changes: 1 } };
          }
          if (query.includes("DELETE FROM repo_environments")) {
            const [id, userId, repoId] = call.bindings;
            const index = rows.findIndex((row) =>
              row.id === id && row.user_id === userId && row.repo_id === repoId,
            );
            if (index >= 0) {
              rows.splice(index, 1);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (query.includes("UPDATE") && query.includes("repo_environments")) {
            const [
              name,
              networkMode,
              extraAllowlistJson,
              includeDefaultAllowlist,
              plainEnvVarsJson,
              startupScript,
              id,
              userId,
              repoId,
            ] = call.bindings as [
              string,
              string,
              string,
              number,
              string,
              string | null,
              string,
              string,
              number,
            ];
            const row = rows.find((item) =>
              item.id === id && item.user_id === userId && item.repo_id === repoId,
            );
            const nameConflict = rows.some((item) =>
              item.id !== id
              && item.user_id === userId
              && item.repo_id === repoId
              && item.name === name,
            );
            if (nameConflict) {
              return { meta: { changes: 0 } };
            }
            if (row) {
              row.name = name;
              row.network_mode = networkMode;
              row.network_extra_allowlist_json = extraAllowlistJson;
              row.network_include_default_allowlist = includeDefaultAllowlist;
              row.plain_env_vars_json = plainEnvVarsJson;
              row.startup_script = startupScript;
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 1 } };
        },
      };
    },
  } as D1Database;
  return { database, rows };
}

function createService(args: {
  database: D1Database;
  accessOk?: boolean;
}) {
  const assertUserRepoAccess = vi.fn(async () =>
    args.accessOk === false
      ? failure({
          code: "REPO_NOT_ACCESSIBLE",
          status: 403 as const,
          message: "No access",
        })
      : success({ repoFullName: "ben/example" }),
  );
  return {
    service: new RepoEnvironmentsService({
      env: { DB: args.database } as Env,
      accessProvider: { assertUserRepoAccess },
    }),
    assertUserRepoAccess,
  };
}

describe("RepoEnvironmentsService", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("lists environments scoped to the user and repo", async () => {
    const { database } = createDatabase([
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        user_id: "user-1",
        repo_id: 42,
        repo_full_name: "ben/web",
        name: "Web",
        network_mode: "locked",
        network_extra_allowlist_json: "[]",
        plain_env_vars_json: "{}",
        startup_script: null,
        created_at: "2026-05-29 00:00:00",
        updated_at: "2026-05-29 00:00:00",
      },
    ]);
    const { service, assertUserRepoAccess } = createService({ database });

    const result = await service.list({
      userId: "user-1",
      repoId: 42,
    });

    expect(result.ok && result.value.environments).toHaveLength(1);
    expect(assertUserRepoAccess).not.toHaveBeenCalled();
  });

  it("lists all environments for settings without repo access checks", async () => {
    const { database } = createDatabase([
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        user_id: "user-1",
        repo_id: 42,
        repo_full_name: "ben/web",
        name: "Web",
        network_mode: "locked",
        network_extra_allowlist_json: "[]",
        plain_env_vars_json: "{}",
        startup_script: null,
        created_at: "2026-05-29 00:00:00",
        updated_at: "2026-05-29 00:00:00",
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174111",
        user_id: "user-2",
        repo_id: 43,
        repo_full_name: "ben/api",
        name: "API",
        network_mode: "open",
        network_extra_allowlist_json: "[]",
        plain_env_vars_json: "{}",
        startup_script: null,
        created_at: "2026-05-29 00:00:00",
        updated_at: "2026-05-29 00:00:00",
      },
    ]);
    const { service, assertUserRepoAccess } = createService({ database });

    const result = await service.listAll({ userId: "user-1" });

    expect(result.ok && result.value.environments).toMatchObject([
      { name: "Web", repoFullName: "ben/web" },
    ]);
    expect(assertUserRepoAccess).not.toHaveBeenCalled();
  });

  it("gets one owned environment for editing without listing all", async () => {
    const { database } = createDatabase([
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        user_id: "user-1",
        repo_id: 42,
        repo_full_name: "ben/web",
        name: "Web",
        network_mode: "locked",
        network_extra_allowlist_json: "[]",
        plain_env_vars_json: "{}",
        startup_script: null,
        created_at: "2026-05-29 00:00:00",
        updated_at: "2026-05-29 00:00:00",
      },
    ]);
    const { service, assertUserRepoAccess } = createService({ database });

    const result = await service.getOwned({
      id: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-1",
    });

    expect(result.ok && result.value.environment).toMatchObject({
      name: "Web",
      repoId: 42,
      repoFullName: "ben/web",
    });
    expect(assertUserRepoAccess).not.toHaveBeenCalled();
  });

  it("rejects requests without repo access", async () => {
    const { database } = createDatabase();
    const { service } = createService({ database, accessOk: false });

    await expect(service.create({
      userId: "user-1",
      githubAccessToken: "token",
      repoId: 42,
      request: {
        name: "Web",
        network: { mode: "locked" },
        plainEnvVars: {},
        startupScript: null,
      },
    })).resolves.toMatchObject({
      ok: false,
      error: { status: 403 },
    });
  });

  it("resolves immutable runtime config for a selected environment", async () => {
    const { database } = createDatabase([
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        user_id: "user-1",
        repo_id: 42,
        repo_full_name: "ben/api",
        name: "API",
        network_mode: "custom",
        network_extra_allowlist_json: "[\"api.stripe.com\"]",
        network_include_default_allowlist: 1,
        plain_env_vars_json: "{\"API_BASE\":\"http://localhost:8787\"}",
        startup_script: "pnpm install",
        created_at: "2026-05-29 00:00:00",
        updated_at: "2026-05-29 00:00:00",
      },
    ]);
    const { service } = createService({ database });

    const result = await service.resolveRuntimeConfig({
      environmentId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "user-1",
      repoId: 42,
    });

    expect(result.ok && result.value).toMatchObject({
      sourceEnvironmentName: "API",
      network: {
        mode: "custom",
        extraAllowlist: ["api.stripe.com"],
        includeDefaultAllowlist: true,
      },
      plainEnvVars: {
        API_BASE: "http://localhost:8787",
      },
      startupScript: "pnpm install",
    });
  });

  it("rejects duplicate environment names", async () => {
    const { database } = createDatabase([
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        user_id: "user-1",
        repo_id: 42,
        repo_full_name: "ben/web",
        name: "Web",
        network_mode: "locked",
        network_extra_allowlist_json: "[]",
        plain_env_vars_json: "{}",
        startup_script: null,
        created_at: "2026-05-29 00:00:00",
        updated_at: "2026-05-29 00:00:00",
      },
    ]);
    const { service } = createService({ database });

    const result = await service.create({
      userId: "user-1",
      githubAccessToken: "token",
      repoId: 42,
      request: {
        name: "Web",
        network: { mode: "locked" },
        plainEnvVars: {},
        startupScript: null,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { status: 409 },
    });
  });

  it("returns an error when a created environment cannot be read back", async () => {
    const environmentId = "123e4567-e89b-12d3-a456-426614174999";
    const randomUuid = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue(environmentId as ReturnType<typeof crypto.randomUUID>);
    const { database } = createDatabase([], {
      failReadsForIds: new Set([environmentId]),
    });
    const { service } = createService({ database });

    try {
      const result = await service.create({
        userId: "user-1",
        githubAccessToken: "token",
        repoId: 42,
        request: {
          name: "Web",
          network: { mode: "locked" },
          plainEnvVars: {},
          startupScript: null,
        },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { status: 503 },
      });
    } finally {
      randomUuid.mockRestore();
    }
  });

  it("rejects duplicate environment names on update", async () => {
    const { database } = createDatabase([
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        user_id: "user-1",
        repo_id: 42,
        repo_full_name: "ben/web",
        name: "Web",
        network_mode: "locked",
        network_extra_allowlist_json: "[]",
        plain_env_vars_json: "{}",
        startup_script: null,
        created_at: "2026-05-29 00:00:00",
        updated_at: "2026-05-29 00:00:00",
      },
      {
        id: "123e4567-e89b-12d3-a456-426614174111",
        user_id: "user-1",
        repo_id: 42,
        repo_full_name: "ben/web",
        name: "API",
        network_mode: "locked",
        network_extra_allowlist_json: "[]",
        plain_env_vars_json: "{}",
        startup_script: null,
        created_at: "2026-05-29 00:00:00",
        updated_at: "2026-05-29 00:00:00",
      },
    ]);
    const { service, assertUserRepoAccess } = createService({ database });

    const result = await service.update({
      id: "123e4567-e89b-12d3-a456-426614174111",
      userId: "user-1",
      repoId: 42,
      request: {
        name: "Web",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { status: 409 },
    });
    expect(assertUserRepoAccess).not.toHaveBeenCalled();
  });
});
