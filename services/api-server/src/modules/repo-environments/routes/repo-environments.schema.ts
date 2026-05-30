import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateRepoEnvironmentRequest,
  DefaultNetworkAllowlistResponse,
  DeleteRepoEnvironmentResponse,
  ListRepoEnvironmentsResponse,
  ListUserRepoEnvironmentsResponse,
  RepoEnvironmentResponse,
  UpdateRepoEnvironmentRequest,
  UserRepoEnvironmentResponse,
} from "@repo/shared";

const ErrorResponse = z.object({ error: z.string(), code: z.string().optional() });
const ErrorResponses = {
  400: {
    content: { "application/json": { schema: ErrorResponse } },
    description: "Invalid repo environment request",
  },
  401: {
    content: { "application/json": { schema: ErrorResponse } },
    description: "GitHub authentication required",
  },
  403: {
    content: { "application/json": { schema: ErrorResponse } },
    description: "Repo access denied",
  },
  404: {
    content: { "application/json": { schema: ErrorResponse } },
    description: "Repo environment not found",
  },
  409: {
    content: { "application/json": { schema: ErrorResponse } },
    description: "Duplicate environment",
  },
  503: {
    content: { "application/json": { schema: ErrorResponse } },
    description: "Repository access could not be verified",
  },
};
const RepoEnvironmentParams = z.object({
  repoId: z.string().regex(/^\d+$/).transform(Number),
});
const RepoEnvironmentIdParams = RepoEnvironmentParams.extend({
  environmentId: z.uuid(),
});
const UserRepoEnvironmentIdParams = z.object({
  environmentId: z.uuid(),
});

export const listUserRepoEnvironmentsRoute = createRoute({
  method: "get",
  path: "/environments",
  responses: {
    200: {
      content: { "application/json": { schema: ListUserRepoEnvironmentsResponse } },
      description: "Current user's repo environments",
    },
    ...ErrorResponses,
  },
});

export const getDefaultNetworkAllowlistRoute = createRoute({
  method: "get",
  path: "/environments/default-allowlist",
  responses: {
    200: {
      content: { "application/json": { schema: DefaultNetworkAllowlistResponse } },
      description: "Default network allowlist domains",
    },
    ...ErrorResponses,
  },
});

export const getUserRepoEnvironmentRoute = createRoute({
  method: "get",
  path: "/environments/{environmentId}",
  request: {
    params: UserRepoEnvironmentIdParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: UserRepoEnvironmentResponse } },
      description: "Current user's repo environment",
    },
    ...ErrorResponses,
  },
});

export const listRepoEnvironmentsRoute = createRoute({
  method: "get",
  path: "/repos/{repoId}/environments",
  request: {
    params: RepoEnvironmentParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: ListRepoEnvironmentsResponse } },
      description: "Repo environments",
    },
    ...ErrorResponses,
  },
});

export const createRepoEnvironmentRoute = createRoute({
  method: "post",
  path: "/repos/{repoId}/environments",
  request: {
    params: RepoEnvironmentParams,
    body: {
      content: { "application/json": { schema: CreateRepoEnvironmentRequest } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: RepoEnvironmentResponse } },
      description: "Repo environment created",
    },
    ...ErrorResponses,
  },
});

export const getRepoEnvironmentRoute = createRoute({
  method: "get",
  path: "/repos/{repoId}/environments/{environmentId}",
  request: {
    params: RepoEnvironmentIdParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: RepoEnvironmentResponse } },
      description: "Repo environment",
    },
    ...ErrorResponses,
  },
});

export const updateRepoEnvironmentRoute = createRoute({
  method: "patch",
  path: "/repos/{repoId}/environments/{environmentId}",
  request: {
    params: RepoEnvironmentIdParams,
    body: {
      content: { "application/json": { schema: UpdateRepoEnvironmentRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: RepoEnvironmentResponse } },
      description: "Repo environment updated",
    },
    ...ErrorResponses,
  },
});

export const deleteRepoEnvironmentRoute = createRoute({
  method: "delete",
  path: "/repos/{repoId}/environments/{environmentId}",
  request: {
    params: RepoEnvironmentIdParams,
  },
  responses: {
    200: {
      content: { "application/json": { schema: DeleteRepoEnvironmentResponse } },
      description: "Repo environment deleted",
    },
    ...ErrorResponses,
  },
});
