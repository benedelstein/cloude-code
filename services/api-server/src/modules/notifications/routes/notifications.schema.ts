import { createRoute, z } from "@hono/zod-openapi";
import {
  RegisterFcmTokenRequest,
  RegisterFcmTokenResponse,
} from "@repo/shared";

const ErrorResponse = z.object({ error: z.string() });

export const registerFcmTokenRoute = createRoute({
  method: "post",
  path: "/fcm-tokens",
  request: {
    body: {
      content: { "application/json": { schema: RegisterFcmTokenRequest } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: RegisterFcmTokenResponse } },
      description: "FCM token registered",
    },
    401: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "Authentication required",
    },
  },
});
