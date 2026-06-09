import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createRepoScopedEnvironmentRoutes, createUserEnvironmentRoutes } from "../../src/modules/repo-environments/routes/repo-environments.routes";
import type { RepoEnvironmentsService } from "../../src/modules/repo-environments/services/repo-environments.service";
import { createReposRoutes, type ReposRouteService } from "../../src/modules/repos/routes/repos.routes";
import type { AuthUser } from "../../src/shared/types/auth";
import type { Env } from "../../src/shared/types";

const USER_ID = "123e4567-e89b-12d3-a456-426614174001";

const testUser: AuthUser = {
  id: USER_ID,
  githubId: 123,
  githubLogin: "ben",
  githubName: "Ben",
  githubAvatarUrl: null,
};

type RouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

function createAuthMiddleware(): MiddlewareHandler<RouteEnv> {
  return async (c, next) => {
    if (c.req.header("Authorization") !== "Bearer good-token") {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", testUser);
    await next();
  };
}

function createReposService(): ReposRouteService {
  return {
    listRepos: vi.fn(async () => ({ ok: true, value: { repos: [] } })),
    searchRepos: vi.fn(async () => ({ ok: true, value: { repos: [] } })),
    listBranches: vi.fn(async () => ({ ok: true, value: { branches: [] } })),
  };
}

describe("repo environment route mounts", () => {
  it("routes repo-scoped environments under /repos without root middleware", async () => {
    const list = vi.fn(async () => ({ ok: true, value: { environments: [] } }));
    const app = new Hono<RouteEnv>();
    const authMiddleware = createAuthMiddleware();

    app.route("/repos", createReposRoutes({
      authMiddleware,
      createReposService,
      getValidGitHubCredentialByUserId: vi.fn(async () =>
        ({ ok: true, value: { accessToken: "github-token" } })),
    }));
    app.route("/repos", createRepoScopedEnvironmentRoutes({
      authMiddleware,
      createRepoEnvironmentsService: () => ({
        list,
      }) as unknown as RepoEnvironmentsService,
    }));

    const response = await app.fetch(new Request("http://test/repos/42/environments", {
      headers: { Authorization: "Bearer good-token" },
    }), {} as Env);

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      userId: USER_ID,
      repoId: 42,
    });
  });

  it("routes user-wide environments under /environments", async () => {
    const listAll = vi.fn(async () => ({ ok: true, value: { environments: [] } }));
    const app = new Hono<RouteEnv>();

    app.route("/environments", createUserEnvironmentRoutes({
      authMiddleware: createAuthMiddleware(),
      createRepoEnvironmentsService: () => ({
        listAll,
      }) as unknown as RepoEnvironmentsService,
    }));

    const response = await app.fetch(new Request("http://test/environments", {
      headers: { Authorization: "Bearer good-token" },
    }), {} as Env);

    expect(response.status).toBe(200);
    expect(listAll).toHaveBeenCalledWith({ userId: USER_ID });
  });
});
