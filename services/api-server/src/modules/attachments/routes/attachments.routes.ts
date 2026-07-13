import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Env } from "@/shared/types";
import type { AuthContext } from "@/shared/types/auth";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@repo/shared";
import { AttachmentService, MAX_ATTACHMENT_BYTES } from "../services/attachment.service";
import {
  uploadAttachmentRoute,
  getAttachmentContentRoute,
  deleteAttachmentRoute,
} from "./attachments.schema";
import { createLogger } from "@/shared/logging";
import { parseImageDimensions } from "../utils/image-dimensions";

type AttachmentsRouteEnv = {
  Bindings: Env;
  Variables: { auth: AuthContext };
};

export interface AttachmentsRouteDeps {
  authMiddleware: MiddlewareHandler<AttachmentsRouteEnv>;
  isSessionOwnedByUser(env: Env, sessionId: string, userId: string): Promise<boolean>;
}

export function createAttachmentsRoutes(
  deps: AttachmentsRouteDeps,
): OpenAPIHono<AttachmentsRouteEnv> {
const attachmentsRoutes = new OpenAPIHono<AttachmentsRouteEnv>();
const logger = createLogger("attachments.routes.ts");

attachmentsRoutes.use("*", deps.authMiddleware);

attachmentsRoutes.openapi(uploadAttachmentRoute, async (c) => {
  const auth = c.get("auth");
  logger.info("Uploading attachments for user", {
    fields: { userId: auth.userId },
  });
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
    const canAccessSession = await deps.isSessionOwnedByUser(c.env, sessionId, auth.userId);
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
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return c.json(
      { error: `Too many files. Max ${MAX_ATTACHMENTS_PER_MESSAGE} per request` },
      400,
    );
  }

  const attachmentService = new AttachmentService(c.env.DB);
  const created = [];
  try {
    logger.info("Uploading attachments to session", {
      fields: { fileCount: files.length, sessionId: sessionId ?? null },
    });
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
      const bytes = await file.arrayBuffer();
      const dimensions = parseImageDimensions(bytes, file.type);

      await c.env.ATTACHMENTS_BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType: file.type },
      });
      logger.debug("Uploaded attachment for session", {
        fields: { attachmentId, sessionId: sessionId ?? null },
      });

      const record = await attachmentService.create({
        id: attachmentId,
        uploaderUserId: auth.userId,
        objectKey,
        filename: file.name || "image",
        mediaType: file.type,
        sizeBytes: file.size,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
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
  const auth = c.get("auth");
  const { attachmentId } = c.req.valid("param");
  const attachmentService = new AttachmentService(c.env.DB);

  const record = await attachmentService.getById(attachmentId);
  if (!record) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  const uploaderCanView = record.uploaderUserId === auth.userId;
  const sessionMemberCanView = record.sessionId
    ? await deps.isSessionOwnedByUser(c.env, record.sessionId, auth.userId)
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
  const auth = c.get("auth");
  const { attachmentId } = c.req.valid("param");
  const attachmentService = new AttachmentService(c.env.DB);
  const record = await attachmentService.getById(attachmentId);
  if (!record) {
    return c.json({ error: "Attachment not found" }, 404);
  }
  if (record.uploaderUserId !== auth.userId) {
    return c.json({ error: "Forbidden" }, 403);
  }

  try {
    await c.env.ATTACHMENTS_BUCKET.delete(record.objectKey);
    await attachmentService.deleteForUploader(attachmentId, auth.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete attachment";
    return c.json({ error: message }, 500);
  }

  return c.body(null, 204);
});

return attachmentsRoutes;
}
