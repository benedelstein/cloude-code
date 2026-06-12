import { OpenAPIHono } from "@hono/zod-openapi";
import type {
  ListBranchesResponse,
  ListReposResponse,
  Result,
  SearchReposResponse,
} from "@repo/shared";
import type { MiddlewareHandler } from "hono";
import type { AuthContext } from "@/shared/types/auth";
import type { GitHubCredentialResult } from "@/shared/types/github-credential";
import type { Env } from "@/shared/types";
import {
  listBranchesRoute,
  listReposRoute,
  searchReposRoute,
} from "./repos.schema";

type ReposRouteEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};

export interface ReposRouteDeps {
  authMiddleware: MiddlewareHandler<ReposRouteEnv>;
  createReposService(env: Env): ReposRouteService;
  getValidGitHubCredentialByUserId(env: Env, userId: string): Promise<GitHubCredentialResult>;
}

type ReposRouteServiceResult<T> = Result<
  T,
  {
    domain: "repos";
    status: 400 | 401 | 503;
    message: string;
    code?: string;
  }
>;

export interface ReposRouteService {
  listRepos(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
    limit?: number;
    cursor?: string;
  }): Promise<ReposRouteServiceResult<ListReposResponse>>;
  searchRepos(params: {
    userId: string;
    githubAccessToken: string;
    executionCtx: ExecutionContext;
    query: string;
    limit?: number;
  }): Promise<ReposRouteServiceResult<SearchReposResponse>>;
  listBranches(params: {
    githubAccessToken: string;
    repoId: number;
    limit?: number;
    cursor?: string;
  }): Promise<ReposRouteServiceResult<ListBranchesResponse>>;
}

export function createReposRoutes(
  deps: ReposRouteDeps,
): OpenAPIHono<ReposRouteEnv> {
  const reposRoutes = new OpenAPIHono<ReposRouteEnv>();

  reposRoutes.use("*", deps.authMiddleware);

  reposRoutes.openapi(listReposRoute, async (c) => {
    const auth = c.get("auth");
    const { limit, cursor } = c.req.valid("query");
    const credentialResult = await deps.getValidGitHubCredentialByUserId(c.env, auth.userId);
    if (!credentialResult.ok) {
      return c.json(
        { error: credentialResult.error.message, code: credentialResult.error.code },
        credentialResult.error.status,
      );
    }
    const reposService = deps.createReposService(c.env);
    const result = await reposService.listRepos({
      userId: auth.userId,
      githubAccessToken: credentialResult.value.accessToken,
      executionCtx: c.executionCtx,
      limit,
      cursor,
    });

    if (!result.ok) {
      return c.json({ error: result.error.message }, result.error.status);
    }

    return c.json(result.value, 200);
  });

  reposRoutes.openapi(searchReposRoute, async (c) => {
    const auth = c.get("auth");
    const { q, limit } = c.req.valid("query");
    const credentialResult = await deps.getValidGitHubCredentialByUserId(c.env, auth.userId);
    if (!credentialResult.ok) {
      return c.json(
        { error: credentialResult.error.message, code: credentialResult.error.code },
        credentialResult.error.status,
      );
    }
    const reposService = deps.createReposService(c.env);
    const result = await reposService.searchRepos({
      userId: auth.userId,
      githubAccessToken: credentialResult.value.accessToken,
      executionCtx: c.executionCtx,
      query: q,
      limit,
    });

    if (!result.ok) {
      return c.json({ error: result.error.message }, result.error.status);
    }

    return c.json(result.value, 200);
  });

  reposRoutes.openapi(listBranchesRoute, async (c) => {
    const auth = c.get("auth");
    const { repoId } = c.req.valid("param");
    const { limit, cursor } = c.req.valid("query");
    const credentialResult = await deps.getValidGitHubCredentialByUserId(c.env, auth.userId);
    if (!credentialResult.ok) {
      return c.json(
        { error: credentialResult.error.message, code: credentialResult.error.code },
        credentialResult.error.status,
      );
    }
    const reposService = deps.createReposService(c.env);
    const result = await reposService.listBranches({
      githubAccessToken: credentialResult.value.accessToken,
      repoId,
      limit,
      cursor,
    });

    if (!result.ok) {
      return c.json({ error: result.error.message }, result.error.status);
    }

    return c.json(result.value, 200);
  });

  return reposRoutes;
}
