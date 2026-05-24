import type { UIMessage } from "ai";
import type { SessionAttachmentProvider } from "@/lib/providers/attachment-provider";
import type { AttachmentRecord } from "@/types/attachments";
import { createUserUiMessage } from "@/lib/utils/uimessage-utils";
import { createLogger } from "@/lib/providers/observability-provider";

export async function buildUserUiMessage(
  sessionId: string,
  initialMessage: string | undefined,
  attachmentIds: string[],
  context: {
    attachmentService: SessionAttachmentProvider;
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
      logger.warn("Some pending attachments missing during init", {
        fields: { attachmentIds },
      });
    }
  }

  return createUserUiMessage(content, attachmentRecords);
}
