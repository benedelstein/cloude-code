import { AttachmentService } from "@/lib/attachments/attachment-service";
import type { AttachmentRecord } from "@/types/attachments";

export interface SessionAttachmentProvider {
  bindUnboundOwnedToSession(
    attachmentIds: string[],
    userId: string,
    sessionId: string,
  ): Promise<boolean>;
  unbindFromSession(
    attachmentIds: string[],
    userId: string,
    sessionId: string,
  ): Promise<void>;
  getByIdsBoundToSession(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]>;
}

export class AttachmentProvider implements SessionAttachmentProvider {
  private readonly service: AttachmentService;

  constructor(database: D1Database) {
    this.service = new AttachmentService(database);
  }

  bindUnboundOwnedToSession(
    attachmentIds: string[],
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    return this.service.bindUnboundOwnedToSession(attachmentIds, userId, sessionId);
  }

  unbindFromSession(
    attachmentIds: string[],
    userId: string,
    sessionId: string,
  ): Promise<void> {
    return this.service.unbindFromSession(attachmentIds, userId, sessionId);
  }

  getByIdsBoundToSession(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]> {
    return this.service.getByIdsBoundToSession(sessionId, attachmentIds);
  }
}
