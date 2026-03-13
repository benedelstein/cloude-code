"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { MessageCircle } from "lucide-react";
import { MessageItem } from "./message-item";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import clsx from "clsx";

interface MessageListProps {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  isHistoryLoading?: boolean;
  isResponding?: boolean;
  pendingUserMessage?: UIMessage | null;
  userAvatarUrl?: string | null;
  // eslint-disable-next-line no-unused-vars
  onHasNewMessages?: (hasNew: boolean) => void;
  scrollToBottomRef?: React.RefObject<(() => void) | null>;
}

export function MessageList({
  messages,
  streamingMessage,
  isHistoryLoading = false,
  isResponding,
  pendingUserMessage,
  userAvatarUrl,
  onHasNewMessages,
  scrollToBottomRef,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabled = useRef(true);
  const hasNewMessages = useRef(false);
  // Keep a ref to the callback so event-handler closures always see the latest
  const onHasNewMessagesRef = useRef(onHasNewMessages);
  onHasNewMessagesRef.current = onHasNewMessages;

  const notifyHasNewMessages = useCallback((hasNew: boolean) => {
    if (hasNewMessages.current === hasNew) {
      return;
    }
    hasNewMessages.current = hasNew;
    onHasNewMessagesRef.current?.(hasNew);
  }, []);

  const isNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    // pb-64 (256px) on the scroll container sits behind the floating input,
    // so the user appears at the bottom well before scrollTop reaches the end.
    const threshold = 200;
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    autoScrollEnabled.current = true;
    notifyHasNewMessages(false);
    bottomRef.current?.scrollIntoView({ behavior });
  }, [notifyHasNewMessages]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const nearBottom = isNearBottom();
      autoScrollEnabled.current = nearBottom;

      if (nearBottom) {
        notifyHasNewMessages(false);
      }
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [isNearBottom, notifyHasNewMessages]);

  // Expose a scroll-to-bottom function to the parent
  useEffect(() => {
    if (scrollToBottomRef) {
      scrollToBottomRef.current = () => {
        scrollToBottom("smooth");
      };
    }
    return () => {
      if (scrollToBottomRef) {
        scrollToBottomRef.current = null;
      }
    };
  }, [scrollToBottom, scrollToBottomRef]);

  // Include streaming part growth so active assistant responses stay pinned while autoscroll is enabled.
  const streamingContentSignal = streamingMessage
    ? `${streamingMessage.id}:${JSON.stringify(streamingMessage.parts ?? []).length}`
    : "idle";
  const contentSignal = [
    messages.length,
    streamingContentSignal,
    pendingUserMessage?.id ?? "none",
    isResponding ? "responding" : "idle",
  ].join(":");

  // Auto-scroll to bottom when new content arrives, only if enabled
  useLayoutEffect(() => {
    if (autoScrollEnabled.current) {
      scrollToBottom("auto");
    } else {
      notifyHasNewMessages(true);
    }
  }, [contentSignal, notifyHasNewMessages, scrollToBottom]);

  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;
  const hasPendingUserMessage = !!pendingUserMessage;
  const shouldRenderPendingUserMessage = hasPendingUserMessage
    && !allMessages.some((message) => message.id === pendingUserMessage.id);

  const showLoading = isHistoryLoading && allMessages.length === 0 && !hasPendingUserMessage;
  const showEmpty = !showLoading && allMessages.length === 0 && !hasPendingUserMessage;

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto pt-20 pb-64"
    >
      {showLoading && (
        <div className="h-full flex items-center justify-center p-4">
          <div className="flex items-center gap-2 text-foreground-muted text-sm">
            <LoadingSpinner className="h-4 w-4" />
            Loading messages...
          </div>
        </div>
      )}
      {showEmpty && (
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
      )}
      {!showLoading && !showEmpty && (
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
      )}
    </div>
  );
}

function TypingIndicator() {
  const dotClass = "w-1.5 h-1.5 bg-accent rounded-full animate-pulse";
  return (
    <div className="flex items-center text-sm gap-1.5 px-2 py-1 w-fit text-foreground-muted">
      Working
      <div className="flex items-center gap-1 translate-y-[1.5px]">
        <span className={dotClass} />
        <span className={clsx([dotClass, "[animation-delay:0.2s]"])} />
        <span className={clsx([dotClass, "[animation-delay:0.4s]"])} />
      </div>
    </div>
  );
}
