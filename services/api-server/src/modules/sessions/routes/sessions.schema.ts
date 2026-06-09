import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionWebSocketTokenResponse,
  UserSessionsWebSocketTokenResponse,
  UpdateSessionTitleRequest,
  UpdateSessionTitleResponse,
  SessionInfoResponse,
  SessionPlanResponse,
  ListSessionsResponse,
  PullRequestResponse,
  PullRequestStatusResponse,
  DeleteSessionResponse,
  ArchiveSessionResponse,
  UIMessageSchema,
} from "@repo/shared";

const ErrorResponse = z.object({ error: z.string() });
const ErrorWithCodeResponse = z.object({
  error: z.string(),
  code: z.string(),
});
const ErrorWithDetailsResponse = z.object({
  error: z.string(),
  details: z.string(),
  code: z.string().optional(),
});
const ErrorWithOptionalDetailsResponse = z.object({
  error: z.string(),
  details: z.string().optional(),
  code: z.string().optional(),
});
const ErrorWithUrlResponse = z.object({
  error: z.string(),
  url: z.string(),
});

export const listSessionsRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: z.object({
      repoId: z.coerce.number().optional()
        .describe("When set, return only the matching repo group, paginated by sessionCursor. " +
          "Otherwise return a page of repo groups, paginated by repoCursor."),
      repoCursor: z.string().optional().describe("Opaque cursor from a previous page's nextRepoCursor"),
      sessionCursor: z.string().optional().describe("Opaque cursor from a previous page's nextSessionCursor"),
      repoLimit: z.coerce.number().int().min(1).max(50).optional().describe("Max repo groups per page"),
      sessionLimit: z.coerce.number().int().min(1).max(50).optional().describe("Max sessions per repo group"),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ListSessionsResponse } },
      description: "Sessions grouped by repo, paginated",
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
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid request",
    },
    401: {
      content: { "application/json": { schema: ErrorWithDetailsResponse } },
      description: "Authentication required to create a session",
    },
    403: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access denied for the requested repository",
    },
    429: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Session creation rate limit exceeded",
    },
    503: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access could not be verified due to a GitHub dependency failure",
    },
    500: {
      content: { "application/json": { schema: ErrorWithDetailsResponse } },
      description: "Failed to create session",
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
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session not found",
    },
    401: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "GitHub authentication required",
    },
    403: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access blocked for this session",
    },
    503: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access could not be verified due to a GitHub dependency failure",
    },
  },
});

export const createSessionWebSocketTokenRoute = createRoute({
  method: "post",
  path: "/{sessionId}/websocket-token",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionWebSocketTokenResponse } },
      description: "Session WebSocket token",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session not found",
    },
    401: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "GitHub authentication required",
    },
    403: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access blocked for this session",
    },
    503: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access could not be verified due to a GitHub dependency failure",
    },
  },
});

export const createUserSessionsWebSocketTokenRoute = createRoute({
  method: "post",
  path: "/updates/token",
  responses: {
    200: {
      content: { "application/json": { schema: UserSessionsWebSocketTokenResponse } },
      description: "User sessions WebSocket token",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Authentication required",
    },
  },
});

export const getUserSessionsUpdatesRoute = createRoute({
  method: "get",
  path: "/updates",
  request: {
    query: z.object({
      token: z.string().optional(),
    }),
  },
  responses: {
    101: {
      description: "User sessions WebSocket stream",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Authentication required",
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
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session not found",
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
      content: { "application/json": { schema: z.array(UIMessageSchema) } },
      description: "Session messages",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session not found",
    },
    401: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "GitHub authentication required",
    },
    403: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access blocked for this session",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Failed to get messages",
    },
    503: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access could not be verified due to a GitHub dependency failure",
    },
  },
});

export const getSessionPlanRoute = createRoute({
  method: "get",
  path: "/{sessionId}/plan",
  request: {
    params: z.object({ sessionId: z.uuid() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: SessionPlanResponse } },
      description: "Latest session plan",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Plan not found",
    },
    401: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "GitHub authentication required",
    },
    403: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access blocked for this session",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Failed to get plan",
    },
    503: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access could not be verified due to a GitHub dependency failure",
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
    400: {
      content: { "application/json": { schema: ErrorWithOptionalDetailsResponse } },
      description: "Bad request or failed to create PR",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session not found",
    },
    401: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "GitHub authentication required",
    },
    403: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access blocked for this session",
    },
    409: {
      content: { "application/json": { schema: ErrorWithUrlResponse } },
      description: "Pull request already exists",
    },
    503: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access could not be verified due to a GitHub dependency failure",
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
    401: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "GitHub authentication required",
    },
    403: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access blocked for this session",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Failed to fetch PR status",
    },
    503: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access could not be verified due to a GitHub dependency failure",
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
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session not found",
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
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Session not found",
    },
    401: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "GitHub authentication required",
    },
    403: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access blocked for this session",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Failed to delete session",
    },
    503: {
      content: { "application/json": { schema: ErrorWithCodeResponse } },
      description: "Repository access could not be verified due to a GitHub dependency failure",
    },
  },
});
