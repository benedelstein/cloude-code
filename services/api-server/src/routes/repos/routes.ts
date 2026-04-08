import { createRoute, z } from "@hono/zod-openapi";
import { ListReposResponse, ListBranchesResponse } from "@repo/shared";

const ErrorResponse = z.object({ error: z.string() });

export const listReposRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ListReposResponse } },
      description: "Paginated list of repos with GitHub App installed",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid pagination cursor",
    },
  },
});

export const listBranchesRoute = createRoute({
  method: "get",
  path: "/{repoId}/branches",
  request: {
    params: z.object({ repoId: z.string().regex(/^\d+$/).transform(Number) }),
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ListBranchesResponse } },
      description: "Paginated list of branches for a repo",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid pagination cursor",
    },
  },
});
