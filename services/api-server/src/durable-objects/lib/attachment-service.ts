import { AttachmentService } from "@/lib/attachments/attachment-service";
import { AttachmentRecord } from "@/types/attachments";
import { arrayBufferToBase64 } from "@/lib/utils";
import { AgentInputAttachment, Logger } from "@repo/shared";
import { Env } from "@/types";

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
   * @returns - resolved attachments as data urls for submitting to the agent. Throws an error if some attachments are not found.
   */
  async resolveAttachments(sessionId: string, attachmentIds: string[]): Promise<{ agentAttachments: AgentInputAttachment[], attachmentRecords: AttachmentRecord[] }> {
    if (attachmentIds.length === 0) {
      return { agentAttachments: [], attachmentRecords: [] };
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
      // todo: typed errors?
      throw new Error("Some attachments not found");
    }

    let agentAttachments: AgentInputAttachment[];
    try {
      agentAttachments = await this.downloadAttachments(attachmentRecords);
    } catch (error) {
      this.logger.error("Failed to resolve attachments for chat", { error });
      throw new Error("Failed to resolve attachments for chat", { cause: error });
    }
    return { agentAttachments, attachmentRecords };
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