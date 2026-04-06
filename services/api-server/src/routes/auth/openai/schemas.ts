import { createRoute, z } from "@hono/zod-openapi";
import {
  OpenAIStatusResponse,
  OpenAIDisconnectResponse,
  OpenAIDeviceStartResponse,
  OpenAIDeviceAttemptResponse,
} from "@repo/shared";
import { authMiddleware } from "@/middleware/auth.middleware";

const ErrorResponse = z.object({
  error: z.string(),
});

export const postOpenAIDeviceStartRoute = createRoute({
  method: "post",
  path: "/openai/device/start",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: OpenAIDeviceStartResponse } },
      description: "OpenAI Codex device authorization start response",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Bad request",
    },
  },
});

export const getOpenAIDeviceAttemptRoute = createRoute({
  method: "get",
  path: "/openai/device/attempts/{attemptId}",
  middleware: [authMiddleware] as const,
  request: {
    params: z.object({
      attemptId: z.string(),
    }),
    query: z.object({
      sessionId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: OpenAIDeviceAttemptResponse } },
      description: "OpenAI Codex device authorization polling status",
    },
  },
});

export const getOpenAIStatusRoute = createRoute({
  method: "get",
  path: "/openai/status",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: OpenAIStatusResponse } },
      description: "OpenAI connection status",
    },
  },
});

export const postOpenAIDisconnectRoute = createRoute({
  method: "post",
  path: "/openai/disconnect",
  middleware: [authMiddleware] as const,
  responses: {
    200: {
      content: { "application/json": { schema: OpenAIDisconnectResponse } },
      description: "Disconnect success",
    },
  },
});
