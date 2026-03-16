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
  const github = new GitHubAppService(c.env, logger);
  const repos: Repo[] = [];
  const cacheWarmEntries: Array<{
    installationId: number;
    repository: {
      id: number;
      fullName: string;
      owner: string;
      name: string;
      defaultBranch: string;
    };
  }> = [];

  const installations = await octokit.paginate(
    octokit.rest.apps.listInstallationsForAuthenticatedUser,
    { per_page: 100 },
  );

  for (const installation of installations) {
    const installationRepositories = await octokit.paginate(
      octokit.rest.apps.listInstallationReposForAuthenticatedUser,
      {
        installation_id: installation.id,
        per_page: 100,
      },
    );
    const repositoriesForCache = installationRepositories.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      owner: repo.owner.login,
      name: repo.name,
      defaultBranch: repo.default_branch,
    }));
    cacheWarmEntries.push(
      ...repositoriesForCache.map((repository) => ({
        installationId: installation.id,
        repository,
      })),
    );

    for (const repo of installationRepositories) {
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

  // cache the results for session creation
  // todo use redis or something.
  c.executionCtx.waitUntil(
    github.warmUserAccessibleRepoAccessCache(
      user.id,
      cacheWarmEntries,
    ).catch((error) => {
      logger.error("Failed to warm GitHub user repo access cache", {
        error,
        fields: {
          userId: user.id,
        },
      });
    }),
  );

  return c.json({ repos, installUrl: github.getInstallUrl() }, 200);
});

// GET /repos/:repoId/branches — list branches for a repo
reposRoutes.openapi(listBranchesRoute, async (c) => {
  // Note: no need to check via installation here because it is just for branches. 
  // We do need to know if the user can access the repo itself via their installation, 
  // but there is no branch scoping if they do have access.
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
