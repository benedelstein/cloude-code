"use client";

import { useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { MessageCircle } from "lucide-react";
import { MessageItem } from "./message-item";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

interface MessageListProps {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  isHistoryLoading?: boolean;
  isResponding?: boolean;
  pendingMessage?: string | null;
}

export function MessageList({
  messages,
  streamingMessage,
  isHistoryLoading = false,
  isResponding,
  pendingMessage,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage, pendingMessage]);

  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;

  if (isHistoryLoading) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="flex items-center gap-2 text-foreground-muted text-sm">
          <LoadingSpinner className="h-4 w-4" />
          Loading messages...
        </div>
      </div>
    );
  }

  if (allMessages.length === 0 && !pendingMessage) {
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
      className="h-full overflow-y-auto p-4"
    >
      <div className="max-w-4xl mx-auto space-y-4">
        {allMessages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            isStreaming={streamingMessage?.id === message.id}
          />
        ))}
        {pendingMessage && (
          <MessageItem
            message={{
              id: "pending-message",
              role: "user",
              parts: [{ type: "text", text: pendingMessage }],
            }}
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
    <div className="flex items-center gap-2 px-4 py-3 w-fit rounded-lg bg-background-secondary border border-border text-foreground-muted shadow-sm">
      Working
      <span className="w-2.5 h-2.5 bg-accent rounded-full animate-pulse" />
      <span className="w-2.5 h-2.5 bg-accent rounded-full animate-pulse [animation-delay:0.2s]" />
      <span className="w-2.5 h-2.5 bg-accent rounded-full animate-pulse [animation-delay:0.4s]" />
    </div>
  );
}
