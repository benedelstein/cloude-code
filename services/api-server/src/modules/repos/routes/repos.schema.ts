import { createRoute, z } from "@hono/zod-openapi";
import { ListReposResponse, ListBranchesResponse, SearchReposResponse } from "@repo/shared";

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
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "GitHub authentication required",
    },
    503: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "GitHub credentials unavailable",
    },
  },
});

export const searchReposRoute = createRoute({
  method: "get",
  path: "/search",
  request: {
    query: z.object({
      q: z.string().min(1).max(200),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SearchReposResponse } },
      description: "Repos matching the query, served from the per-user cache",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid search request",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "GitHub authentication required",
    },
    503: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "GitHub credentials unavailable",
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
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "GitHub authentication required",
    },
    503: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "GitHub credentials unavailable",
    },
  },
});
