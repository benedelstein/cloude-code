import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateSessionRequest,
  CreateSessionResponse,
  UpdateSessionTitleRequest,
  UpdateSessionTitleResponse,
  SessionInfoResponse,
  ListSessionsResponse,
  PullRequestResponse,
  PullRequestStatusResponse,
  DeleteSessionResponse,
  ArchiveSessionResponse,
  EditorOpenResponse,
  EditorCloseResponse,
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

export const updateSessionTitleRoute = createRoute({
  method: "patch",
  path: "/{sessionId}/title",
  request: {
    params: z.object({ sessionId: z.uuid() }),
    body: {
      content: { "application/json": { schema: UpdateSessionTitleRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: UpdateSessionTitleResponse } },
      description: "Session title updated",
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

const ErrorResponse = z.object({ error: z.string() });
const ErrorWithDetailsResponse = z.object({
  error: z.string(),
  details: z.string(),
});
const ErrorWithOptionalDetailsResponse = z.object({
  error: z.string(),
  details: z.string().optional(),
});
const ErrorWithUrlResponse = z.object({
  error: z.string(),
  url: z.string(),
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
    400: {
      content: { "application/json": { schema: ErrorWithOptionalDetailsResponse } },
      description: "Bad request or failed to create PR",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session not found",
    },
    409: {
      content: { "application/json": { schema: ErrorWithUrlResponse } },
      description: "Pull request already exists",
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
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid repo",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session or PR not found",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Failed to fetch PR status",
    },
  },
});

export const archiveSessionRoute = createRoute({
  method: "post",
  path: "/{sessionId}/archive",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ArchiveSessionResponse } },
      description: "Session archived",
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
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Failed to delete session",
    },
  },
});

export const openEditorRoute = createRoute({
  method: "post",
  path: "/{sessionId}/editor/open",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: EditorOpenResponse } },
      description: "Editor URL and connection token",
    },
    500: {
      content: { "application/json": { schema: ErrorWithDetailsResponse } },
      description: "Failed to open editor",
    },
  },
});

export const closeEditorRoute = createRoute({
  method: "post",
  path: "/{sessionId}/editor/close",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: EditorCloseResponse } },
      description: "Editor closed",
    },
    500: {
      content: { "application/json": { schema: ErrorWithDetailsResponse } },
      description: "Failed to close editor",
    },
  },
});
