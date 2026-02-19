import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionInfoResponse,
  ListSessionsResponse,
  PullRequestResponse,
  PullRequestStatusResponse,
  DeleteSessionResponse,
} from "@repo/shared";

export const listSessionsRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: z.object({
      repoId: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ListSessionsResponse } },
      description: "Paginated list of sessions",
    },
  },
});

export const createSessionRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: { "application/json": { schema: CreateSessionRequest } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: CreateSessionResponse } },
      description: "Created session",
    },
  },
});

export const getSessionRoute = createRoute({
  method: "get",
  path: "/{sessionId}",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionInfoResponse } },
      description: "Session info",
    },
  },
});

export const getSessionMessagesRoute = createRoute({
  method: "get",
  path: "/{sessionId}/messages",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      description: "Session messages",
    },
  },
});

export const createPullRequestRoute = createRoute({
  method: "post",
  path: "/{sessionId}/pr",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    201: {
      content: { "application/json": { schema: PullRequestResponse } },
      description: "Created pull request",
    },
  },
});

export const getPullRequestRoute = createRoute({
  method: "get",
  path: "/{sessionId}/pr",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: PullRequestStatusResponse } },
      description: "Pull request status",
    },
  },
});

export const deleteSessionRoute = createRoute({
  method: "delete",
  path: "/{sessionId}",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: DeleteSessionResponse } },
      description: "Session deleted",
    },
  },
});
