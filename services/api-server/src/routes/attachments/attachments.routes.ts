import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "@/types";
import { authMiddleware, type AuthUser } from "@/middleware/auth.middleware";
import { AttachmentService, MAX_ATTACHMENTS_PER_REQUEST, MAX_ATTACHMENT_BYTES } from "@/lib/attachments/attachment-service";
import { SessionHistoryService } from "@/lib/session-history";
import {
  uploadAttachmentRoute,
  getAttachmentContentRoute,
  deleteAttachmentRoute,
} from "./schema";
import { logger } from "@/lib/logger";

export const attachmentsRoutes = new OpenAPIHono<{
  Bindings: Env;
  Variables: { user: AuthUser };
}>();

attachmentsRoutes.use("/", authMiddleware);

attachmentsRoutes.openapi(uploadAttachmentRoute, async (c) => {
  const user = c.get("user");
  logger.info(`uploading attachments for user ${user.id}`);
  const formData = await c.req.raw.formData();
  const sessionIdRaw = formData.get("sessionId");
  const parsedSessionId = sessionIdRaw
    ? z.uuid().safeParse(sessionIdRaw)
    : { success: true as const, data: undefined };

  if (!parsedSessionId.success) {
    return c.json({ error: "Invalid sessionId" }, 400);
  }

  const sessionId = parsedSessionId.data;
  if (sessionId) {
    const sessionHistory = new SessionHistoryService(c.env.DB);
    const canAccessSession = await sessionHistory.isOwnedByUser(sessionId, user.id);
    if (!canAccessSession) {
      return c.json({ error: "Session not found" }, 404);
    }
  }

  const files: File[] = [];
  for (const value of formData.values()) {
    if (value instanceof File) {
      files.push(value);
    }
  }

  if (files.length === 0) {
    return c.json({ error: "No files provided" }, 400);
  }
  if (files.length > MAX_ATTACHMENTS_PER_REQUEST) {
    return c.json(
      { error: `Too many files. Max ${MAX_ATTACHMENTS_PER_REQUEST} per request` },
      400,
    );
  }

  const attachmentService = new AttachmentService(c.env.DB);
  const created = [];
  try {
    logger.info(`uploading ${files.length} attachments to session ${sessionId}`);
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return c.json(
          { error: `Unsupported media type: ${file.type || "unknown"}` },
          400,
        );
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return c.json(
          { error: `File too large (${file.name}). Max ${MAX_ATTACHMENT_BYTES} bytes` },
          400,
        );
      }

      const attachmentId = crypto.randomUUID();
      const objectKey = attachmentService.buildObjectKey(attachmentId);

      await c.env.ATTACHMENTS_BUCKET.put(objectKey, file.stream(), {
        httpMetadata: { contentType: file.type },
      });
      logger.debug(`uploaded attachment ${attachmentId} for session ${sessionId}`);

      const record = await attachmentService.create({
        id: attachmentId,
        uploaderUserId: user.id,
        objectKey,
        filename: file.name || "image",
        mediaType: file.type,
        sizeBytes: file.size,
        sessionId: sessionId ?? null,
      });
      created.push(record);
    }
  } catch (error) {
    for (const record of created) {
      await c.env.ATTACHMENTS_BUCKET.delete(record.objectKey);
      await attachmentService.deleteById(record.id);
    }
    const message = error instanceof Error ? error.message : "Failed to store attachments";
    return c.json({ error: message }, 500);
  }

  return c.json(
    {
      attachments: created.map((record) => attachmentService.toDescriptor(record)),
    },
    201,
  );
});

attachmentsRoutes.openapi(getAttachmentContentRoute, async (c) => {
  const user = c.get("user");
  const { attachmentId } = c.req.valid("param");
  const attachmentService = new AttachmentService(c.env.DB);
  const sessionHistory = new SessionHistoryService(c.env.DB);

  const record = await attachmentService.getById(attachmentId);
  if (!record) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  const uploaderCanView = record.uploaderUserId === user.id;
  const sessionMemberCanView = record.sessionId
    ? await sessionHistory.isOwnedByUser(record.sessionId, user.id)
    : false;
  if (!uploaderCanView && !sessionMemberCanView) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const object = await c.env.ATTACHMENTS_BUCKET.get(record.objectKey);
  if (!object || !object.body) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  const headers = new Headers();
  headers.set("Content-Type", record.mediaType);
  headers.set("Cache-Control", "private, max-age=300");
  if (object.size !== undefined) {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(object.body, { status: 200, headers });
});

attachmentsRoutes.openapi(deleteAttachmentRoute, async (c) => {
  const user = c.get("user");
  const { attachmentId } = c.req.valid("param");
  const attachmentService = new AttachmentService(c.env.DB);
  const record = await attachmentService.getById(attachmentId);
  if (!record) {
    return c.json({ error: "Attachment not found" }, 404);
  }
  if (record.uploaderUserId !== user.id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  try {
    await c.env.ATTACHMENTS_BUCKET.delete(record.objectKey);
    await attachmentService.deleteForUploader(attachmentId, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete attachment";
    return c.json({ error: message }, 500);
  }

  return c.body(null, 204);
});
