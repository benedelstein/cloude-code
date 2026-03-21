import { AttachmentRecord } from "@/types/attachments";
import { UIMessage } from "ai";

/**
 * Builds a UIMessage from user content suitable for storing in the database.
 * @param content the text content
 * @param attachments attachment references from R2
 * @param id 
 * @returns a UIMessage, or null if no content or attachments were provided.
 */
export function createUserUiMessage(
  content: string | undefined,
  attachments: AttachmentRecord[],
  id: string = crypto.randomUUID(),
): UIMessage | null {
  const messageParts: UIMessage["parts"] = [];
  if (content) {
    messageParts.push({ type: "text", text: content });
  }
  for (const attachment of attachments) {
    messageParts.push({
      type: "file",
      mediaType: attachment.mediaType,
      filename: attachment.filename,
      url: buildAttachmentContentUrl(attachment.id), // this for persisting to db not for sending to agent.
    } as UIMessage["parts"][number]);
  }

  if (messageParts.length === 0) {
    return null;
  }

  return { id, role: "user", parts: messageParts };
}

export const getUserMessageTextContent = (
  message: UIMessage | null,
): string | undefined => {
  if (!message) {
    return undefined;
  }

  const text = message.parts
    .flatMap((part) =>
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part
        ? [String(part.text)]
        : [],
    )
    .join("")
    .trim();

  return text || undefined;
};

export const buildAttachmentContentUrl = (attachmentId: string): string => {
  return `/attachments/${attachmentId}/content`;
};