import { createRoute, z } from "@hono/zod-openapi";
import { ListReposResponse, ListBranchesResponse } from "@repo/shared";

export const listReposRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: ListReposResponse } },
      description: "List of repos with GitHub App installed",
    },
  },
});

export const listBranchesRoute = createRoute({
  method: "get",
  path: "/{repoId}/branches",
  request: {
    params: z.object({ repoId: z.string().regex(/^\d+$/).transform(Number) }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ListBranchesResponse } },
      description: "List of branches for a repo",
    },
  },
});
