"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Loader2, ArrowDown } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { useSessionList, useSessionTitle } from "@/components/providers/session-list-provider";
import {
  APP_RIGHT_SIDEBAR_WIDTH,
  useAppRightSidebar,
} from "@/components/layout/app-right-sidebar-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/use-auth";
import { useProviderAuth } from "@/hooks/use-provider-auth";
import {
  updateSessionTitle as updateSessionTitleRequest,
  uploadAttachments,
  deleteAttachment,
} from "@/lib/client-api";
import { getFadeScaleVisibilityClasses } from "@/lib/utils";
import { AppHeaderPortal } from "@/components/layout/app-header-context";
import { StatusBanner } from "./status-banner";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { BranchBar } from "./branch-bar";
import { SessionActionsButton } from "./editor-button";
import { InputFrame } from "./input-frame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProviderId } from "@repo/shared";

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const {
    messages,
    streamingMessage,
    sessionStatus,
    sessionErrorMessage,
    sessionErrorCode,
    operationError,
    isHistoryLoading,
    isReady,
    isResponding,
    repoFullName,
    pendingUserMessage,
    pushedBranch,
    pullRequestState,
    selectedModel,
    setSelectedModel,
    selectedProvider,
    agentMode,
    setAgentMode,
    providerAuthRequired,
    sendMessage,
    stop,
  } = useSession();
  const { enabled: isRightSidebarEnabled, open: isRightSidebarOpen } = useAppRightSidebar();
  const isMobile = useIsMobile();

  const { user } = useAuth();
  const providerAuth = useProviderAuth({ sessionId });
  const { updateTitle } = useSessionList();
  const sessionTitle = useSessionTitle(sessionId);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const rightSidebarInset = !isMobile && isRightSidebarEnabled && isRightSidebarOpen
    ? APP_RIGHT_SIDEBAR_WIDTH
    : "0rem";

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

  const handleProviderModelChange = (providerId: ProviderId, modelId: string) => {
    if (selectedProvider !== providerId) {
      return;
    }
    setSelectedModel(modelId);
  };

  return (
    <div className="h-full flex flex-col">
      <AppHeaderPortal>
        <div className="flex min-w-0 w-full items-center justify-between gap-3">
          <div className="min-w-0 flex flex-1 flex-col gap-0 overflow-hidden">
            <div className="group/title flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <input
                ref={titleInputRef}
                value={isEditingTitle ? titleInput : displayTitle}
                readOnly={!isEditingTitle}
                onChange={(event) => setTitleInput(event.target.value)}
                onFocus={() => {
                  if (!isEditingTitle && !isSavingTitle) {
                    startEditingTitle();
                  }
                }}
                onBlur={() => {
                  if (isEditingTitle) {
                    if (canSaveTitle) {
                      void saveTitle();
                    } else {
                      cancelEditingTitle();
                    }
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (canSaveTitle) {
                      void saveTitle();
                    } else {
                      cancelEditingTitle();
                    }
                    titleInputRef.current?.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEditingTitle();
                    titleInputRef.current?.blur();
                  }
                }}
                maxLength={60}
                size={Math.max(1, (isEditingTitle ? titleInput : displayTitle)?.length || 1)}
                className="h-7 max-w-full min-w-[2ch] shrink truncate rounded-md border border-transparent bg-transparent px-2 text-sm font-medium cursor-pointer focus:cursor-text focus:border-border focus:bg-background focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
              {isSavingTitle ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-foreground-muted" />
              ) : (
                <Pencil className="h-3.5 w-3.5 shrink-0 text-foreground-muted opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-within/title:opacity-0 pointer-events-none" />
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* TODO: REENABLE WHEN THESE WORK. */}
            {/* <BrowserButton /> */}
            {/* <EditorButton sessionId={sessionId} editorUrl={editorUrl} disabled={!isReady} /> */}
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
          sessionErrorMessage={sessionErrorMessage}
          sessionErrorCode={sessionErrorCode}
          isResponding={isResponding}
          pendingUserMessage={pendingUserMessage}
          userAvatarUrl={user?.avatarUrl}
          rightInset={rightSidebarInset}
          onHasNewMessages={setShowScrollToBottom}
          scrollToBottomRef={scrollToBottomRef}
        />
      </div>

      {/* Branch Bar + Input - floating at bottom */}
      <div className="sticky bottom-0 z-10 h-0 flex flex-col justify-end">
        <div
          className="pt-8 transition-[padding] duration-200 ease-linear"
          style={{ paddingRight: rightSidebarInset }}
        >
          <div className="max-w-4xl mx-auto px-4 pb-6" style={{ background: "linear-gradient(to bottom, transparent, var(--background-secondary) 32px)" }}>
            <div className={getFadeScaleVisibilityClasses(showScrollToBottom, {
              className: "mb-2 flex justify-center",
            })}>
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
              pullRequestState={pullRequestState}
            />
            <InputFrame>
              <StatusBanner
                sessionStatus={sessionStatus}
                sessionErrorMessage={sessionErrorMessage}
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
                isStreaming={isResponding}
                agentMode={agentMode}
                onAgentModeChange={setAgentMode}
                selectedProvider={selectedProvider}
                selectedModel={selectedModel}
                onProviderModelChange={handleProviderModelChange}
                providerAuthHandles={providerAuth.handles}
                providerAuthRequired={providerAuthRequired}
                operationErrorMessage={operationError?.message ?? null}
                disabledPlaceholder={sessionErrorMessage ?? undefined}
              />
            </InputFrame>
            <p className="mt-2 text-center text-xs text-foreground-muted/60">
              Press Enter to submit, Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
