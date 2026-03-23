import { AttachmentService } from "@/lib/attachments/attachment-service";
import { AttachmentRecord } from "@/types/attachments";
import { arrayBufferToBase64 } from "@/lib/utils";
import {
  type AgentInputAttachment,
  type DomainError,
  type Logger,
  type Result,
  failure,
  success,
} from "@repo/shared";
import { Env } from "@/types";

const ATTACHMENT_RESOLUTION_DOMAIN = "attachment_resolution";

export type ResolveAttachmentsResult = Result<{
  agentAttachments: AgentInputAttachment[];
  attachmentRecords: AttachmentRecord[];
}, AttachmentResolutionError>;

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

function attachmentResolutionError<Code extends AttachmentResolutionError["code"]>(
  code: Code,
  message: string,
  details: Omit<Extract<AttachmentResolutionError, { code: Code }>, "domain" | "code" | "message">,
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
  private readonly attachmentService: AttachmentService;

  constructor(env: Env, logger: Logger) {
    this.env = env;
    this.logger = logger;
    this.attachmentService = new AttachmentService(env.DB);
  }

  /**
   * Resolves attachments and downloads them to data urls for submitting to the agent.
   * @param sessionId - session id to resolve attachments for.
   * @param attachmentReferences - references to attachments to resolve.
   * @returns - resolved attachments as data urls for submitting to the agent.
   */
  async resolveAttachments(sessionId: string, attachmentIds: string[]): Promise<ResolveAttachmentsResult> {
    if (attachmentIds.length === 0) {
      return success({ agentAttachments: [], attachmentRecords: [] });
    }
    const attachmentRecords = await this.attachmentService.getByIdsBoundToSession(
      sessionId,
      attachmentIds,
    );

    if (attachmentRecords.length !== attachmentIds.length) {
      this.logger.error(
        "Some attachments not found: " +
          attachmentIds.join(", "),
      );
      return failure(attachmentResolutionError(
        "ATTACHMENTS_NOT_FOUND",
        "Some attachments not found.",
        { attachmentIds },
      ));
    }

    let agentAttachments: AgentInputAttachment[];
    try {
      agentAttachments = await this.downloadAttachments(attachmentRecords);
    } catch (error) {
      this.logger.error("Failed to resolve attachments for chat", { error });
      return failure(attachmentResolutionError(
        "ATTACHMENTS_RESOLUTION_FAILED",
        "Failed to resolve attachments for chat.",
        { attachmentIds },
      ));
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
}
