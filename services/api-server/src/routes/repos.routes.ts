import { Hono } from "hono";
import { Octokit } from "octokit";
import type { Env } from "@/types";
import { authMiddleware, type AuthUser } from "@/middleware/auth.middleware";
import { GitHubAppService } from "@/lib/github";

export const reposRoutes = new Hono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

reposRoutes.use("*", authMiddleware);

// GET /repos — list repos where the GitHub App is installed, visible to the authenticated user
reposRoutes.get("/", async (c) => {
  const user = c.get("user");
  const octokit = new Octokit({ auth: user.githubAccessToken });

  const { data } =
    await octokit.rest.apps.listInstallationsForAuthenticatedUser();

  const repos: Array<{
    id: number;
    name: string;
    fullName: string;
    owner: string;
    private: boolean;
    description: string | null;
    defaultBranch: string;
  }> = [];

  for (const installation of data.installations) {
    const { data: repoData } =
      await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
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

  const github = new GitHubAppService(c.env);
  return c.json({ repos, installUrl: github.getInstallUrl() });
});
