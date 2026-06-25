import type { AttachmentRecord } from "@/shared/types/attachments";

export interface CreateAttachmentParams {
  id: string;
  uploaderUserId: string;
  objectKey: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sessionId?: string | null;
}

interface AttachmentRow {
  id: string;
  uploader_user_id: string;
  object_key: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
  session_id: string | null;
  bound_at: string | null;
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

export class AttachmentRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(params: CreateAttachmentParams): Promise<AttachmentRecord> {
    const now = new Date().toISOString();
    const sessionId = params.sessionId ?? null;
    const boundAt = sessionId ? now : null;
    await this.database
      .prepare(
        `INSERT INTO attachments (
          id, uploader_user_id, object_key, filename, media_type, size_bytes, width, height,
          created_at, session_id, bound_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.id,
        params.uploaderUserId,
        params.objectKey,
        params.filename,
        params.mediaType,
        params.sizeBytes,
        params.width,
        params.height,
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
      width: params.width,
      height: params.height,
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

  async deleteById(attachmentId: string): Promise<void> {
    await this.database
      .prepare(`DELETE FROM attachments WHERE id = ?`)
      .bind(attachmentId)
      .run();
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
    attachmentId: string,
    uploaderUserId: string,
    sessionId: string,
  ): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE attachments
         SET session_id = ?, bound_at = datetime('now')
         WHERE id = ? AND uploader_user_id = ? AND session_id IS NULL`,
      )
      .bind(sessionId, attachmentId, uploaderUserId)
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async unbindFromSession(
    attachmentId: string,
    uploaderUserId: string,
    sessionId: string,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE attachments
         SET session_id = NULL, bound_at = NULL
         WHERE id = ? AND uploader_user_id = ? AND session_id = ?`,
      )
      .bind(attachmentId, uploaderUserId, sessionId)
      .run();
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

  private toAttachmentRecord(row: AttachmentRow): AttachmentRecord {
    return {
      id: row.id,
      uploaderUserId: row.uploader_user_id,
      objectKey: row.object_key,
      filename: row.filename,
      mediaType: row.media_type,
      sizeBytes: row.size_bytes,
      width: row.width,
      height: row.height,
      createdAt: row.created_at,
      sessionId: row.session_id,
      boundAt: row.bound_at,
    };
  }
}
