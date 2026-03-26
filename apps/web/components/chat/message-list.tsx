"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type { ListReposResponse } from "@repo/shared";
import { AlertTriangle, MessageCircle } from "lucide-react";
import { listRepos } from "@/lib/client-api";
import { CACHE_KEY_REPOS, readCache } from "@/lib/swr-cache";
import { MessageItem } from "./message-item";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import clsx from "clsx";

interface MessageListProps {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  isHistoryLoading?: boolean;
  sessionErrorMessage?: string | null;
  sessionErrorCode?: string | null;
  isResponding?: boolean;
  pendingUserMessage?: UIMessage | null;
  userAvatarUrl?: string | null;
  rightInset?: string;
  // eslint-disable-next-line no-unused-vars
  onHasNewMessages?: (hasNew: boolean) => void;
  scrollToBottomRef?: React.RefObject<(() => void) | null>;
}

export function MessageList({
  messages,
  streamingMessage,
  isHistoryLoading = false,
  sessionErrorMessage = null,
  sessionErrorCode = null,
  isResponding,
  pendingUserMessage,
  userAvatarUrl,
  rightInset = "0rem",
  onHasNewMessages,
  scrollToBottomRef,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabled = useRef(true);
  const hasNewMessages = useRef(false);
  const pendingAutoScrollBehavior = useRef<ScrollBehavior>("auto");
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior, persistBehavior = true) => {
    autoScrollEnabled.current = true;
    if (persistBehavior) {
      pendingAutoScrollBehavior.current = behavior;
    }
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
      const behavior = pendingAutoScrollBehavior.current;
      pendingAutoScrollBehavior.current = "auto";
      scrollToBottom(behavior, false);
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

  const showError = sessionErrorMessage !== null
    && allMessages.length === 0
    && !hasPendingUserMessage;
  const showLoading = !showError && isHistoryLoading && allMessages.length === 0 && !hasPendingUserMessage;
  const showEmpty = !showError && !showLoading && allMessages.length === 0 && !hasPendingUserMessage;

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto pt-20 pb-64 transition-[padding] duration-200 ease-linear"
      style={{ paddingRight: rightInset }}
    >
      {showError && (
        <div className="h-full flex items-center justify-center p-6">
          <BlockedSessionState
            message={sessionErrorMessage}
            errorCode={sessionErrorCode}
          />
        </div>
      )}
      {showLoading && (
        <div className="h-full flex items-center justify-center p-4">
          <div className="flex items-center gap-2 text-foreground-muted text-sm">
            {/* TODO: USE SKELETON */}
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
      {!showError && !showLoading && !showEmpty && (
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

function BlockedSessionState({
  message,
  errorCode,
}: {
  message: string;
  errorCode: string | null;
}) {
  const [installUrl, setInstallUrl] = useState<string | null>(() => {
    if (errorCode !== "REPO_ACCESS_BLOCKED") {
      return null;
    }

    const cachedRepos = readCache<ListReposResponse>(CACHE_KEY_REPOS);
    return cachedRepos?.data.installUrl ?? null;
  });

  useEffect(() => {
    if (errorCode !== "REPO_ACCESS_BLOCKED") {
      setInstallUrl(null);
      return;
    }

    const cachedRepos = readCache<ListReposResponse>(CACHE_KEY_REPOS);
    if (cachedRepos?.data.installUrl) {
      setInstallUrl(cachedRepos.data.installUrl);
      return;
    }

    let stale = false;

    void listRepos()
      .then((response) => {
        if (!stale) {
          setInstallUrl(response.installUrl);
        }
      })
      .catch(() => {
        if (!stale) {
          setInstallUrl(null);
        }
      });

    return () => {
      stale = true;
    };
  }, [errorCode]);

  return (
    <div className="w-full max-w-xl text-center">
      <div className="flex flex-col items-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/8 text-danger">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-foreground">
          Error connecting to session
        </h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-foreground-muted">
          {message}
        </p>
        {errorCode === "REPO_ACCESS_BLOCKED" && installUrl && (
          <Link
            href={installUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground hover:bg-background transition-colors"
          >
            <svg
              className="h-4 w-4 shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Configure repo access on GitHub
          </Link>
        )}
      </div>
    </div>
  );
}
