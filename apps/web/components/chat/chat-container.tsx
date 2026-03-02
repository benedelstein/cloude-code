"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/components/providers/session-provider";
import { useSessionList, useSessionTitle } from "@/components/providers/session-list-provider";
import { updateSessionTitle as updateSessionTitleRequest } from "@/lib/api";
import { StatusBanner } from "./status-banner";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { BranchBar } from "./branch-bar";
import { EditorButton } from "./editor-button";
import Link from "next/link";

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const {
    messages,
    streamingMessage,
    sessionStatus,
    errorMessage,
    isReady,
    isStreaming,
    isResponding,
    repoFullName,
    pendingMessage,
    pushedBranch,
    pullRequestUrl,
    pullRequestState,
    editorUrl,
    sendMessage,
    stop,
  } = useSession();

  const { updateTitle } = useSessionList();
  const sessionTitle = useSessionTitle(sessionId);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const displayTitle = sessionTitle ?? repoFullName ?? "Untitled session";
  const canSaveTitle = titleInput.trim().length > 0
    && titleInput.trim() !== (sessionTitle ?? "").trim();

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleInput(sessionTitle ?? "");
    }
  }, [isEditingTitle, sessionTitle]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  const startEditingTitle = () => {
    setTitleInput(sessionTitle ?? "");
    setIsEditingTitle(true);
  };

  const cancelEditingTitle = () => {
    setTitleInput(sessionTitle ?? "");
    setIsEditingTitle(false);
  };

  const saveTitle = async () => {
    const nextTitle = titleInput.trim();
    const previousTitle = sessionTitle;
    const previousNormalized = (previousTitle ?? "").trim();

    if (!nextTitle) {
      return;
    }

    if (nextTitle === previousNormalized) {
      setIsEditingTitle(false);
      return;
    }

    setIsSavingTitle(true);
    setIsEditingTitle(false);
    updateTitle(sessionId, nextTitle);

    try {
      await updateSessionTitleRequest(sessionId, nextTitle);
    } catch (error) {
      console.error("Failed to update session title:", error);
      updateTitle(sessionId, previousTitle);
      setTitleInput(previousTitle ?? "");
    } finally {
      setIsSavingTitle(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="shrink-0 h-12 border-b border-border px-4 flex items-center w-full">
        <div className="max-w-4xl mx-auto flex items-center justify-between w-full">
          <div className="flex flex-col gap-0 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              {isEditingTitle ? (
                <>
                  <input
                    ref={titleInputRef}
                    value={titleInput}
                    onChange={(event) => setTitleInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (canSaveTitle) {
                          void saveTitle();
                        }
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEditingTitle();
                      }
                    }}
                    maxLength={60}
                    className="h-7 w-full min-w-0 rounded border border-border bg-background px-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void saveTitle()}
                    disabled={isSavingTitle || !canSaveTitle}
                    className="shrink-0 h-7 w-7 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
                    title="Save title"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditingTitle}
                    disabled={isSavingTitle}
                    className="shrink-0 h-7 w-7 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
                    title="Cancel"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium truncate">
                    {displayTitle}
                  </p>
                  <button
                    type="button"
                    onClick={startEditingTitle}
                    disabled={isSavingTitle}
                    className="shrink-0 h-6 w-6 rounded text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
                    title="Rename session"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                  {isSavingTitle && (
                    <span className="text-xs text-muted-foreground">Saving...</span>
                  )}
                </>
              )}
            </div>
            {repoFullName && (
              <Link href={`https://github.com/${repoFullName}`} target="_blank" className="text-xs text-muted-foreground truncate hover:underline">
                {repoFullName}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <EditorButton sessionId={sessionId} editorUrl={editorUrl} disabled={!isReady} />
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  sessionStatus === "ready"
                    ? "bg-green-500"
                    : "bg-yellow-500"
                }`}
              />
              <span className="text-xs text-muted-foreground capitalize">
                {sessionStatus}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Status Banner */}
      <StatusBanner
        sessionStatus={sessionStatus}
        errorMessage={errorMessage}
      />

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={messages}
          streamingMessage={streamingMessage}
          isResponding={isResponding}
          pendingMessage={pendingMessage}
        />
      </div>

      {/* Branch Bar */}
      <BranchBar
        sessionId={sessionId}
        pushedBranch={pushedBranch}
        pullRequestUrl={pullRequestUrl}
        pullRequestState={pullRequestState}
      />

      {/* Input */}
      <div className="shrink-0 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <ChatInput
            onSend={sendMessage}
            onStop={stop}
            disabled={!isReady}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
