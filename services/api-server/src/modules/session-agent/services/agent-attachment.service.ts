import type { AttachmentRecord } from "@/shared/types/attachments";
import { arrayBufferToBase64 } from "@/shared/utils/utils";
import {
  type AgentInputAttachment,
  type DomainError,
  type Logger,
  type Result,
  failure,
  success,
} from "@repo/shared";
import type { Env } from "@/shared/types";

const ATTACHMENT_RESOLUTION_DOMAIN = "attachment_resolution";

export type ResolveAttachmentsResult = Result<
  {
    agentAttachments: AgentInputAttachment[];
    attachmentRecords: AttachmentRecord[];
  },
  AttachmentResolutionError
>;

export type AttachmentResolutionError =
  | DomainError<
      typeof ATTACHMENT_RESOLUTION_DOMAIN,
      "ATTACHMENTS_NOT_FOUND",
      { attachmentIds: string[] }
    >
  | DomainError<
      typeof ATTACHMENT_RESOLUTION_DOMAIN,
      "ATTACHMENTS_RESOLUTION_FAILED",
      { attachmentIds: string[] }
    >;

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

function attachmentResolutionError<
  Code extends AttachmentResolutionError["code"],
>(
  code: Code,
  message: string,
  details: Omit<
    Extract<AttachmentResolutionError, { code: Code }>,
    "domain" | "code" | "message"
  >,
): Extract<AttachmentResolutionError, { code: Code }> {
  return {
    domain: ATTACHMENT_RESOLUTION_DOMAIN,
    code,
    message,
    ...details,
  } as Extract<AttachmentResolutionError, { code: Code }>;
}

export class AgentAttachmentService {
  private readonly env: Env;
  private readonly logger: Logger;

  constructor(env: Env, logger: Logger) {
    this.env = env;
    this.logger = logger;
  }

  /**
   * Resolves attachments and downloads them to data urls for submitting to the agent.
   * @param sessionId - session id to resolve attachments for.
   * @param attachmentReferences - references to attachments to resolve.
   * @returns - resolved attachments as data urls for submitting to the agent.
   */
  async resolveAttachments(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<ResolveAttachmentsResult> {
    if (attachmentIds.length === 0) {
      return success({ agentAttachments: [], attachmentRecords: [] });
    }
    const attachmentRecords = await this.getByIdsBoundToSession(
      sessionId,
      attachmentIds,
    );

    if (attachmentRecords.length !== attachmentIds.length) {
      this.logger.error("Some attachments not found", {
        fields: { attachmentIds },
      });
      return failure(
        attachmentResolutionError(
          "ATTACHMENTS_NOT_FOUND",
          "Some attachments not found.",
          { attachmentIds },
        ),
      );
    }

    let agentAttachments: AgentInputAttachment[];
    try {
      agentAttachments = await this.downloadAttachments(attachmentRecords);
    } catch (error) {
      this.logger.error("Failed to resolve attachments for chat", { error });
      return failure(
        attachmentResolutionError(
          "ATTACHMENTS_RESOLUTION_FAILED",
          "Failed to resolve attachments for chat.",
          { attachmentIds },
        ),
      );
    }
    return success({ agentAttachments, attachmentRecords });
  }

  /**
   * Converts attachment into data urls for submitting to the agent.
   * @param attachments
   * @returns
   */
  async downloadAttachments(
    attachments: AttachmentRecord[],
  ): Promise<AgentInputAttachment[]> {
    const resolved: AgentInputAttachment[] = [];
    for (const attachment of attachments) {
      const object = await this.env.ATTACHMENTS_BUCKET.get(
        attachment.objectKey,
      );
      if (!object || !object.body) {
        throw new Error(`Attachment content missing for ${attachment.id}`);
      }
      const bytes = await object.arrayBuffer();
      const base64 = arrayBufferToBase64(bytes);
      resolved.push({
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        dataUrl: `data:${attachment.mediaType};base64,${base64}`,
      });
    }
    return resolved;
  }

  private async getByIdsBoundToSession(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]> {
    if (attachmentIds.length === 0) {
      return [];
    }
    const placeholders = attachmentIds.map(() => "?").join(", ");
    const rows = await this.env.DB.prepare(
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
