import type { AttachmentRecord } from "@/shared/types/attachments";
import type { AttachmentDescriptor } from "@repo/shared";
import {
  AttachmentRepository,
  type AttachmentGcTask,
  type CreateAttachmentParams,
} from "../repositories/attachment.repository";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_REQUEST = 20;

export class AttachmentService {
  private readonly repository: AttachmentRepository;

  constructor(database: D1Database) {
    this.repository = new AttachmentRepository(database);
  }

  async create(params: CreateAttachmentParams): Promise<AttachmentRecord> {
    return this.repository.create(params);
  }

  async getById(attachmentId: string): Promise<AttachmentRecord | null> {
    return this.repository.getById(attachmentId);
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
    await this.repository.deleteById(attachmentId);
    return "deleted";
  }

  async deleteById(attachmentId: string): Promise<void> {
    await this.repository.deleteById(attachmentId);
  }

  async clearGcTaskByObjectKey(objectKey: string): Promise<void> {
    await this.repository.clearGcTaskByObjectKey(objectKey);
  }

  async getByIdsBoundToSession(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]> {
    return this.repository.getByIdsBoundToSession(sessionId, attachmentIds);
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
      const bound = await this.repository.bindUnboundOwnedToSession(
        attachmentId,
        uploaderUserId,
        sessionId,
      );
      if (!bound) {
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
      await this.repository.unbindFromSession(
        attachmentId,
        uploaderUserId,
        sessionId,
      );
    }
  }

  async listGcTasks(limit: number, maxRetries: number): Promise<AttachmentGcTask[]> {
    return this.repository.listGcTasks(limit, maxRetries);
  }

  async markGcTaskDone(taskId: number): Promise<void> {
    await this.repository.markGcTaskDone(taskId);
  }

  async markGcTaskFailed(taskId: number, errorMessage: string): Promise<void> {
    await this.repository.markGcTaskFailed(taskId, errorMessage);
  }

  toDescriptor(record: AttachmentRecord): AttachmentDescriptor {
    return {
      attachmentId: record.id,
      filename: record.filename,
      mediaType: record.mediaType,
      sizeBytes: record.sizeBytes,
      ...(record.width !== null && record.height !== null
        ? { width: record.width, height: record.height }
        : {}),
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
}
