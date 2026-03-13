"use client";

import { useCallback, useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { MessageCircle } from "lucide-react";
import { MessageItem } from "./message-item";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

interface MessageListProps {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  isHistoryLoading?: boolean;
  isResponding?: boolean;
  pendingUserMessage?: UIMessage | null;
  userAvatarUrl?: string | null;
}

export function MessageList({
  messages,
  streamingMessage,
  isHistoryLoading = false,
  isResponding,
  pendingUserMessage,
  userAvatarUrl,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const checkIfNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const threshold = 150;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= threshold;
  }, []);

  // Auto-scroll to bottom only when user is already near the bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingMessage, pendingUserMessage]);

  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;
  const hasPendingUserMessage = pendingUserMessage !== null && pendingUserMessage !== undefined;
  const shouldRenderPendingUserMessage = hasPendingUserMessage
    && !allMessages.some((message) => message.id === pendingUserMessage.id);

  if (isHistoryLoading && allMessages.length === 0 && !hasPendingUserMessage) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="flex items-center gap-2 text-foreground-muted text-sm">
          <LoadingSpinner className="h-4 w-4" />
          Loading messages...
        </div>
      </div>
    );
  }

  if (allMessages.length === 0 && !hasPendingUserMessage) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent-subtle flex items-center justify-center">
            <MessageCircle className="w-8 h-8 text-accent" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Start a conversation</h3>
          <p className="text-foreground-muted text-sm">
            Send a message to begin working with the agent on your repository.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={checkIfNearBottom}
      className="h-full overflow-y-auto pt-20 pb-64"
    >
      <div className="max-w-4xl mx-auto px-8 space-y-4">
        {allMessages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            isStreaming={streamingMessage?.id === message.id}
            userAvatarUrl={userAvatarUrl}
          />
        ))}
        {shouldRenderPendingUserMessage && pendingUserMessage && (
          <MessageItem
            message={pendingUserMessage}
            userAvatarUrl={userAvatarUrl}
          />
        )}
        {isResponding && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 w-fit rounded-lg bg-background border border-border text-foreground-muted shadow-shadow shadow-md">
      Working
      <span className="w-2.5 h-2.5 bg-accent rounded-full animate-pulse" />
      <span className="w-2.5 h-2.5 bg-accent rounded-full animate-pulse [animation-delay:0.2s]" />
      <span className="w-2.5 h-2.5 bg-accent rounded-full animate-pulse [animation-delay:0.4s]" />
    </div>
  );
}
