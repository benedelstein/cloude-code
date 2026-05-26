import { OpenAPIHono } from "@hono/zod-openapi";
import type {
  ListBranchesResponse,
  ListReposResponse,
  Result,
  SearchReposResponse,
} from "@repo/shared";
import type { MiddlewareHandler } from "hono";
import type { AuthUser } from "@/shared/types/auth";
import type { Env } from "@/shared/types";
import { listBranchesRoute, listReposRoute, searchReposRoute } from "./repos.schema";

type ReposRouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export interface ReposRouteDeps {
  authMiddleware: MiddlewareHandler<ReposRouteEnv>;
  createReposService(env: Env): ReposRouteService;
}

type ReposRouteServiceResult<T> = Result<T, {
  domain: "repos";
  status: 400;
  message: string;
}>;

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

export function createReposRoutes(deps: ReposRouteDeps): OpenAPIHono<ReposRouteEnv> {
const reposRoutes = new OpenAPIHono<ReposRouteEnv>();

reposRoutes.use("*", deps.authMiddleware);

reposRoutes.openapi(listReposRoute, async (c) => {
  const user = c.get("user");
  const { limit, cursor } = c.req.valid("query");
  const reposService = deps.createReposService(c.env);
  const result = await reposService.listRepos({
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
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
  const user = c.get("user");
  const { q, limit } = c.req.valid("query");
  const reposService = deps.createReposService(c.env);
  const result = await reposService.searchRepos({
    userId: user.id,
    githubAccessToken: user.githubAccessToken,
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
  const user = c.get("user");
  const { repoId } = c.req.valid("param");
  const { limit, cursor } = c.req.valid("query");
  const reposService = deps.createReposService(c.env);
  const result = await reposService.listBranches({
    githubAccessToken: user.githubAccessToken,
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
