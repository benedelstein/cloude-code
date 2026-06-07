import { createRoute, z } from "@hono/zod-openapi";
import {
  VoiceTranscriptionResponse,
  VoiceTranscriptionTokenResponse,
} from "@repo/shared";

const ErrorResponse = z.object({ error: z.string() });

export const createVoiceTranscriptionTokenRoute = createRoute({
  method: "post",
  path: "/transcriptions/token",
  responses: {
    200: {
      content: { "application/json": { schema: VoiceTranscriptionTokenResponse } },
      description: "Voice transcription upload token",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Authentication required",
    },
  },
});

export const transcribeVoiceRoute = createRoute({
  method: "post",
  path: "/transcriptions",
  responses: {
    200: {
      content: { "application/json": { schema: VoiceTranscriptionResponse } },
      description: "Transcribed voice input",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid transcription request",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Invalid voice upload token",
    },
    413: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Audio file too large",
    },
    500: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Transcription is not configured",
    },
    502: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Transcription provider failed",
    },
  },
});
