import { UIMessage } from "ai";
import { AttachmentService } from "./attachments/attachment-service";
import { AttachmentRecord } from "@/types/attachments";
import { createUserUiMessage } from "./utils/uimessage-utils";
import { createLogger } from "./logger";

export async function buildUserUiMessage(
  sessionId: string,
  initialMessage: string | undefined,
  attachmentIds: string[],
  context: {
    attachmentService: AttachmentService;
  },
): Promise<UIMessage | null> {
  const logger = createLogger("buildUserUiMessage");
  const content = initialMessage?.trim();
  if (!content && attachmentIds.length === 0) {
    return null;
  }

  let attachmentRecords: AttachmentRecord[] = [];
  if (attachmentIds.length > 0) {
    attachmentRecords = await context.attachmentService.getByIdsBoundToSession(
      sessionId,
      attachmentIds,
    );
    if (attachmentRecords.length !== attachmentIds.length) {
      logger.warn(
        `Some pending attachments missing during init: ${attachmentIds.join(", ")}`,
      );
    }
  }

  return createUserUiMessage(content, attachmentRecords);
}
