import { createRoute, z } from "@hono/zod-openapi";
import { UploadAttachmentResponse } from "@repo/shared";

export const uploadAttachmentRoute = createRoute({
  method: "post",
  path: "/",
  responses: {
    201: {
      content: { "application/json": { schema: UploadAttachmentResponse } },
      description: "Uploaded attachment(s)",
    },
    400: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Invalid upload request",
    },
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Session not found",
    },
    500: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Failed to store attachment(s)",
    },
  },
});

export const getAttachmentContentRoute = createRoute({
  method: "get",
  path: "/{attachmentId}/content",
  request: {
    params: z.object({ attachmentId: z.uuid() }),
  },
  responses: {
    200: {
      description: "Attachment content bytes",
    },
    403: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Forbidden",
    },
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Attachment not found",
    },
  },
});

export const deleteAttachmentRoute = createRoute({
  method: "delete",
  path: "/{attachmentId}",
  request: {
    params: z.object({ attachmentId: z.uuid() }),
  },
  responses: {
    204: {
      description: "Attachment deleted",
    },
    403: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Forbidden",
    },
    404: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Attachment not found",
    },
    500: {
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
      description: "Failed to delete attachment",
    },
  },
});
