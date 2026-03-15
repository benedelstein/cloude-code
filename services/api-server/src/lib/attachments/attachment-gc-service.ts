import type { Env } from "../../types";
import { AttachmentService } from "./attachment-service";

const ATTACHMENT_GC_BATCH_SIZE = 100;
const ATTACHMENT_GC_MAX_RETRIES = 20;

export async function drainAttachmentGcQueue(env: Env): Promise<void> {
  const attachmentService = new AttachmentService(env.DB);
  const tasks = await attachmentService.listGcTasks(
    ATTACHMENT_GC_BATCH_SIZE,
    ATTACHMENT_GC_MAX_RETRIES,
  );
  for (const task of tasks) {
    try {
      await env.ATTACHMENTS_BUCKET.delete(task.objectKey);
      await attachmentService.markGcTaskDone(task.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await attachmentService.markGcTaskFailed(task.id, errorMessage);
    }
  }
}
