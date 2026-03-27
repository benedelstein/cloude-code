import type { UIMessage } from "ai";
import type { AttachmentDescriptor } from "@repo/shared";

const SESSION_PENDING_USER_MESSAGE_PREFIX = "session-pending-user-message:";
const initialPendingUserMessageCache = new Map<string, UIMessage>();

function getStorageKey(sessionId: string): string {
  return `${SESSION_PENDING_USER_MESSAGE_PREFIX}${sessionId}`;
}

function isValidPendingUserMessage(
  message: Partial<UIMessage> | null | undefined,
): message is UIMessage {
  return (
    typeof message?.id === "string"
    && message.role === "user"
    && Array.isArray(message.parts)
  );
}

export function buildOptimisticUserMessage({
  content,
  attachments = [],
}: {
  content?: string;
  attachments?: AttachmentDescriptor[];
}): UIMessage | null {
  const trimmedContent = content?.trim();
  if (!trimmedContent && attachments.length === 0) {
    return null;
  }

  const parts: UIMessage["parts"] = [];
  if (trimmedContent) {
    parts.push({ type: "text", text: trimmedContent });
  }

  for (const attachment of attachments) {
    parts.push({
      type: "file",
      mediaType: attachment.mediaType,
      filename: attachment.filename,
      url: attachment.contentUrl,
    } as UIMessage["parts"][number]);
  }

  return {
    id: crypto.randomUUID(),
    role: "user",
    parts,
  };
}

export function storeInitialPendingUserMessage(
  sessionId: string,
  message: UIMessage,
): void {
  if (typeof window === "undefined") {
    return;
  }

  initialPendingUserMessageCache.set(sessionId, message);
  sessionStorage.setItem(getStorageKey(sessionId), JSON.stringify(message));
}

export function consumeInitialPendingUserMessage(sessionId: string): UIMessage | null {
  if (typeof window === "undefined") {
    return null;
  }

  const memoryCachedMessage = initialPendingUserMessageCache.get(sessionId);
  if (memoryCachedMessage) {
    initialPendingUserMessageCache.delete(sessionId);
    sessionStorage.removeItem(getStorageKey(sessionId));
    return memoryCachedMessage;
  }

  const storageKey = getStorageKey(sessionId);
  const rawValue = sessionStorage.getItem(storageKey);
  if (!rawValue) {
    return null;
  }

  sessionStorage.removeItem(storageKey);

  try {
    const parsed = JSON.parse(rawValue) as Partial<UIMessage>;
    return isValidPendingUserMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
