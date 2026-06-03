import type { UIMessage } from "ai";
import type { CreateSessionInitialMessage } from "@repo/shared";
import type { AttachmentRecord } from "@/shared/types/attachments";
import { createUserUiMessage } from "@/shared/utils/uimessage-utils";
import { createLogger } from "@/shared/logging";

export interface UserMessageAttachmentProvider {
  getByIdsBoundToSession(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]>;
}

export async function buildUserUiMessage(
  sessionId: string,
  initialMessage: CreateSessionInitialMessage,
  context: {
    attachmentService: UserMessageAttachmentProvider;
  },
): Promise<UIMessage> {
  const logger = createLogger("buildUserUiMessage");
  const content = initialMessage.content?.trim();
  const attachmentIds = initialMessage.attachmentIds ?? [];

  let attachmentRecords: AttachmentRecord[] = [];
  if (attachmentIds.length > 0) {
    attachmentRecords = await context.attachmentService.getByIdsBoundToSession(
      sessionId,
      attachmentIds,
    );
    if (attachmentRecords.length !== attachmentIds.length) {
      logger.warn("Some pending attachments missing during init", {
        fields: { attachmentIds },
      });
    }
  }

  const userMessage = createUserUiMessage(content, attachmentRecords);
  if (!userMessage) {
    throw new Error("Expected initial user message to include content or attachments");
  }

  return userMessage;
}
