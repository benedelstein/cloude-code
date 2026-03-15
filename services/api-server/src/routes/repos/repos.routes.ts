import { OpenAPIHono } from "@hono/zod-openapi";
import { Octokit } from "octokit";
import type { Env } from "@/types";
import { authMiddleware, type AuthUser } from "@/middleware/auth.middleware";
import { GitHubAppService } from "@/lib/github";
import { logger } from "@/lib/logger";
import { listReposRoute, listBranchesRoute } from "./routes";
import type { Repo } from "@repo/shared";

export const reposRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

reposRoutes.use("*", authMiddleware);

// GET /repos — list repos where the GitHub App is installed, visible to the authenticated user
reposRoutes.openapi(listReposRoute, async (c) => {
  const user = c.get("user");
  const octokit = new Octokit({ auth: user.githubAccessToken });

  const { data } = await octokit.rest.apps.listInstallationsForAuthenticatedUser();

  const repos: Repo[] = [];

  for (const installation of data.installations) {
    // TODO: Paginate this.
    const { data: repoData } = await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
        installation_id: installation.id,
      });

    for (const repo of repoData.repositories) {
      repos.push({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        owner: repo.owner.login,
        private: repo.private,
        description: repo.description,
        defaultBranch: repo.default_branch,
      });
    }
  }

  const github = new GitHubAppService(c.env, logger);
  return c.json({ repos, installUrl: github.getInstallUrl() }, 200);
});

// GET /repos/:repoId/branches — list branches for a repo
reposRoutes.openapi(listBranchesRoute, async (c) => {
  const user = c.get("user");
  const { repoId } = c.req.valid("param");
  const octokit = new Octokit({ auth: user.githubAccessToken });

  // Resolve repo owner/name from numeric ID
  const { data: repo } = await octokit.request("GET /repositories/{repository_id}", {
    repository_id: repoId,
  });

  const branches: { name: string; default: boolean }[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.repos.listBranches, {
    owner: repo.owner.login,
    repo: repo.name,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const branch of response.data) {
      branches.push({
        name: branch.name,
        default: branch.name === repo.default_branch,
      });
    }
  }

  return c.json({ branches }, 200);
});
