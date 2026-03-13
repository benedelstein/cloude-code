"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Check, X, ArrowDown } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/components/providers/session-provider";
import { useSessionList, useSessionTitle } from "@/components/providers/session-list-provider";
import { useAuth } from "@/hooks/use-auth";
import { useClaudeAuth } from "@/hooks/use-claude-auth";
import {
  updateSessionTitle as updateSessionTitleRequest,
  uploadAttachments,
  deleteAttachment,
} from "@/lib/client-api";
import { AppHeaderPortal } from "@/components/layout/app-header-context";
import { StatusBanner } from "./status-banner";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { BranchBar } from "./branch-bar";
import { BrowserButton, EditorButton, SessionActionsButton } from "./editor-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const {
    messages,
    streamingMessage,
    sessionStatus,
    errorMessage,
    isHistoryLoading,
    isReady,
    isStreaming,
    isResponding,
    repoFullName,
    pendingUserMessage,
    pushedBranch,
    pullRequestUrl,
    pullRequestState,
    editorUrl,
    claudeAuthRequired: claudeAuthState,
    sendMessage,
    stop,
  } = useSession();

  const { user } = useAuth();
  const claude = useClaudeAuth({ sessionId });
  const { updateTitle } = useSessionList();
  const sessionTitle = useSessionTitle(sessionId);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollToBottomRef = useRef<(() => void) | null>(null);

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
      <AppHeaderPortal>
        <div className="flex items-center justify-between w-full gap-4">
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
                    className="h-7 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                  <button
                    type="button"
                    onClick={() => void saveTitle()}
                    disabled={isSavingTitle || !canSaveTitle}
                    className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md border border-border text-foreground-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
                    title="Save title"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditingTitle}
                    disabled={isSavingTitle}
                    className="shrink-0 h-7 w-7 flex items-center justify-center rounded-md border border-border text-foreground-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
                    title="Cancel"
                  >
                    <X className="h-3.5 w-3.5" />
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
                    className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-foreground-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
                    title="Rename session"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {isSavingTitle && (
                    <span className="text-xs text-foreground-muted">Saving...</span>
                  )}
                </>
              )}
            </div>
            {repoFullName && (
              <Link href={`https://github.com/${repoFullName}`} target="_blank" className="text-xs text-foreground-muted truncate hover:underline">
                {repoFullName}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <BrowserButton />
            <EditorButton sessionId={sessionId} editorUrl={editorUrl} disabled={!isReady} />
            <SessionActionsButton sessionId={sessionId} />
          </div>
        </div>
      </AppHeaderPortal>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessageList
          messages={messages}
          streamingMessage={streamingMessage}
          isHistoryLoading={isHistoryLoading}
          isResponding={isResponding}
          pendingUserMessage={pendingUserMessage}
          userAvatarUrl={user?.avatarUrl}
          onHasNewMessages={setShowScrollToBottom}
          scrollToBottomRef={scrollToBottomRef}
        />
      </div>

      {/* Branch Bar + Input - floating at bottom */}
      <div className="sticky bottom-0 z-10 h-0 flex flex-col justify-end">
        <div className="pt-8">
          <div className="max-w-4xl mx-auto px-4 pb-6" style={{ background: "linear-gradient(to bottom, transparent, var(--background) 32px)" }}>
            <div className={`flex justify-center mb-2 transition-all duration-200 ${showScrollToBottom ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => scrollToBottomRef.current?.()}
                    className="h-8 w-8 flex items-center justify-center rounded-full border border-border bg-background shadow-shadow shadow-md text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>New messages</TooltipContent>
              </Tooltip>
            </div>
            <BranchBar
              sessionId={sessionId}
              pushedBranch={pushedBranch}
              pullRequestUrl={pullRequestUrl}
              pullRequestState={pullRequestState}
            />
            <div className="rounded-lg border border-border-strong bg-background shadow-shadow shadow-xl focus-within:ring-1 focus-within:ring-accent/50 focus-within:border-accent/50 transition-shadow">
              <StatusBanner
                sessionStatus={sessionStatus}
                errorMessage={errorMessage}
              />
              <ChatInput
                onSend={(...args) => {
                  scrollToBottomRef.current?.();
                  sendMessage(...args);
                }}
                onUploadAttachments={(files) => uploadAttachments(files, sessionId).then((response) => response.attachments)}
                onDeleteAttachment={(attachmentId) => deleteAttachment(attachmentId)}
                onStop={stop}
                disabled={!isReady}
                isStreaming={isStreaming}
                claude={claude}
                claudeAuthRequired={claudeAuthState}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
