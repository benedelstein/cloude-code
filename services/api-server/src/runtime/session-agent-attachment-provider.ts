import type { SessionChatAttachmentProvider } from "@/modules/session-agent/services/session-chat-dispatch.service";
import type { AttachmentRecord } from "@/shared/types/attachments";

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

export class SessionAgentAttachmentProvider implements SessionChatAttachmentProvider {
  constructor(private readonly database: D1Database) {}

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
