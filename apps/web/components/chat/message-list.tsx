"use client";

import { useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { MessageItem } from "./message-item";

interface MessageListProps {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  isResponding?: boolean;
  pendingMessage?: string | null;
}

export function MessageList({ messages, streamingMessage, isResponding, pendingMessage }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage, pendingMessage]);

  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;

  if (allMessages.length === 0 && !pendingMessage) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent/10 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-accent"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Start a conversation</h3>
          <p className="text-muted-foreground text-sm">
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
    <div className="flex items-center gap-2 px-4 py-3 w-fit rounded-2xl bg-white border border-zinc-200 text-zinc-700 shadow-sm">
      Working
      <span className="w-2.5 h-2.5 bg-zinc-400 rounded-full animate-pulse" />
      <span className="w-2.5 h-2.5 bg-zinc-400 rounded-full animate-pulse [animation-delay:0.2s]" />
      <span className="w-2.5 h-2.5 bg-zinc-400 rounded-full animate-pulse [animation-delay:0.4s]" />
    </div>
  );
}
