import { OpenAPIHono } from "@hono/zod-openapi";
import { ReposService } from "@/lib/repos/repos.service";
import { authMiddleware, type AuthUser } from "@/middleware/auth.middleware";
import type { Env } from "@/types";
import { listBranchesRoute, listReposRoute } from "./routes";

export const reposRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

reposRoutes.use("*", authMiddleware);

reposRoutes.openapi(listReposRoute, async (c) => {
  const user = c.get("user");
  const { limit, cursor } = c.req.valid("query");
  const reposService = new ReposService(c.env);
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

reposRoutes.openapi(listBranchesRoute, async (c) => {
  const user = c.get("user");
  const { repoId } = c.req.valid("param");
  const { limit, cursor } = c.req.valid("query");
  const reposService = new ReposService(c.env);
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
