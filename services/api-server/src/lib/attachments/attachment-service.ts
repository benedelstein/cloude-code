import type { AttachmentDescriptor } from "@repo/shared";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_REQUEST = 20;

interface CreateAttachmentParams {
  id: string;
  uploaderUserId: string;
  objectKey: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  sessionId?: string | null;
}

interface AttachmentRow {
  id: string;
  uploader_user_id: string;
  object_key: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  created_at: string;
  session_id: string | null;
  bound_at: string | null;
}

export interface AttachmentRecord {
  id: string;
  uploaderUserId: string;
  objectKey: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
  sessionId: string | null;
  boundAt: string | null;
}

interface AttachmentGcQueueRow {
  id: number;
  object_key: string;
  retry_count: number;
}

export interface AttachmentGcTask {
  id: number;
  objectKey: string;
  retryCount: number;
}

export class AttachmentService {
  constructor(private readonly database: D1Database) {}

  async create(params: CreateAttachmentParams): Promise<AttachmentRecord> {
    const now = new Date().toISOString();
    const sessionId = params.sessionId ?? null;
    const boundAt = sessionId ? now : null;

    await this.database
      .prepare(
        `INSERT INTO attachments (
          id, uploader_user_id, object_key, filename, media_type, size_bytes, created_at, session_id, bound_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.id,
        params.uploaderUserId,
        params.objectKey,
        params.filename,
        params.mediaType,
        params.sizeBytes,
        now,
        sessionId,
        boundAt,
      )
      .run();

    return {
      id: params.id,
      uploaderUserId: params.uploaderUserId,
      objectKey: params.objectKey,
      filename: params.filename,
      mediaType: params.mediaType,
      sizeBytes: params.sizeBytes,
      createdAt: now,
      sessionId,
      boundAt,
    };
  }

  async getById(attachmentId: string): Promise<AttachmentRecord | null> {
    const row = await this.database
      .prepare(`SELECT * FROM attachments WHERE id = ?`)
      .bind(attachmentId)
      .first<AttachmentRow>();
    if (!row) {
      return null;
    }
    return this.toAttachmentRecord(row);
  }

  async deleteForUploader(
    attachmentId: string,
    uploaderUserId: string,
  ): Promise<"deleted" | "forbidden" | "not_found"> {
    const record = await this.getById(attachmentId);
    if (!record) {
      return "not_found";
    }
    if (record.uploaderUserId !== uploaderUserId) {
      return "forbidden";
    }
    await this.database
      .prepare(`DELETE FROM attachments WHERE id = ?`)
      .bind(attachmentId)
      .run();
    return "deleted";
  }

  async clearGcTaskByObjectKey(objectKey: string): Promise<void> {
    await this.database
      .prepare(`DELETE FROM attachment_gc_queue WHERE object_key = ?`)
      .bind(objectKey)
      .run();
  }

  async getByIdsBoundToSession(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]> {
    if (attachmentIds.length === 0) {
      return [];
    }
    const placeholders = attachmentIds.map(() => "?").join(", ");
    const rows = await this.database
      .prepare(
        `SELECT * FROM attachments
         WHERE session_id = ? AND id IN (${placeholders})`,
      )
      .bind(sessionId, ...attachmentIds)
      .all<AttachmentRow>();
    const byId = new Map(
      (rows.results ?? []).map((row) => [row.id, this.toAttachmentRecord(row)]),
    );
    return attachmentIds
      .map((attachmentId) => byId.get(attachmentId))
      .filter((record): record is AttachmentRecord => record !== undefined);
  }

  async bindUnboundOwnedToSession(
    attachmentIds: string[],
    uploaderUserId: string,
    sessionId: string,
  ): Promise<boolean> {
    if (attachmentIds.length === 0) {
      return true;
    }

    const boundAttachmentIds: string[] = [];
    for (const attachmentId of attachmentIds) {
      const result = await this.database
        .prepare(
          `UPDATE attachments
           SET session_id = ?, bound_at = datetime('now')
           WHERE id = ? AND uploader_user_id = ? AND session_id IS NULL`,
        )
        .bind(sessionId, attachmentId, uploaderUserId)
        .run();
      if ((result.meta?.changes ?? 0) !== 1) {
        await this.unbindFromSession(boundAttachmentIds, uploaderUserId, sessionId);
        return false;
      }
      boundAttachmentIds.push(attachmentId);
    }
    return true;
  }

  async unbindFromSession(
    attachmentIds: string[],
    uploaderUserId: string,
    sessionId: string,
  ): Promise<void> {
    if (attachmentIds.length === 0) {
      return;
    }
    for (const attachmentId of attachmentIds) {
      await this.database
        .prepare(
          `UPDATE attachments
           SET session_id = NULL, bound_at = NULL
           WHERE id = ? AND uploader_user_id = ? AND session_id = ?`,
        )
        .bind(attachmentId, uploaderUserId, sessionId)
        .run();
    }
  }

  async listGcTasks(limit: number, maxRetries: number): Promise<AttachmentGcTask[]> {
    const rows = await this.database
      .prepare(
        `SELECT id, object_key, retry_count
         FROM attachment_gc_queue
         WHERE retry_count < ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .bind(maxRetries, limit)
      .all<AttachmentGcQueueRow>();
    return (rows.results ?? []).map((row) => ({
      id: row.id,
      objectKey: row.object_key,
      retryCount: row.retry_count,
    }));
  }

  async markGcTaskDone(taskId: number): Promise<void> {
    await this.database
      .prepare(`DELETE FROM attachment_gc_queue WHERE id = ?`)
      .bind(taskId)
      .run();
  }

  async markGcTaskFailed(taskId: number, errorMessage: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE attachment_gc_queue
         SET retry_count = retry_count + 1,
             last_error = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(errorMessage.slice(0, 1000), taskId)
      .run();
  }

  toDescriptor(record: AttachmentRecord): AttachmentDescriptor {
    return {
      attachmentId: record.id,
      filename: record.filename,
      mediaType: record.mediaType,
      sizeBytes: record.sizeBytes,
      createdAt: record.createdAt,
      sessionId: record.sessionId,
      contentUrl: this.buildContentUrl(record.id),
    };
  }

  buildObjectKey(attachmentId: string): string {
    return `attachments/${attachmentId}`;
  }

  buildContentUrl(attachmentId: string): string {
    return `/attachments/${attachmentId}/content`;
  }

  private toAttachmentRecord(row: AttachmentRow): AttachmentRecord {
    return {
      id: row.id,
      uploaderUserId: row.uploader_user_id,
      objectKey: row.object_key,
      filename: row.filename,
      mediaType: row.media_type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      sessionId: row.session_id,
      boundAt: row.bound_at,
    };
  }
}
