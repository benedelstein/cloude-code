"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square } from "lucide-react";
import { ChatAttachmentPreviews } from "@/components/chat/chat-attachment-previews";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import type { useClaudeAuth } from "@/hooks/use-claude-auth";
import { ClaudeSigninPanel } from "@/app/(app)/claude-signin-panel";
import type {
  ClaudeModel,
  MessageAttachmentRef,
  AttachmentDescriptor,
  ClaudeAuthState,
} from "@repo/shared";
import { ModelSelector } from "@/components/model-selector";
import { ImageAttachButton } from "@/components/chat/image-attach-button";
import { toast } from "sonner";

type ClaudeAuth = ReturnType<typeof useClaudeAuth>;

interface ChatInputProps {
  // eslint-disable-next-line no-unused-vars
  onSend: (message: {
    content?: string;
    attachments?: MessageAttachmentRef[];
    optimisticAttachments?: AttachmentDescriptor[];
  }) => void;
  // eslint-disable-next-line no-unused-vars
  onUploadAttachments: (files: File[]) => Promise<AttachmentDescriptor[]>;
  // eslint-disable-next-line no-unused-vars
  onDeleteAttachment: (attachmentId: string) => Promise<void>;
  onStop: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  model?: ClaudeModel;
  // eslint-disable-next-line no-unused-vars
  onModelChange?: (model: ClaudeModel) => void;
  claude: ClaudeAuth;
  claudeAuthRequired: ClaudeAuthState | null;
  operationErrorMessage?: string | null;
}

export function ChatInput({
  onSend,
  onUploadAttachments,
  onDeleteAttachment,
  onStop,
  disabled = false,
  isStreaming = false,
  model,
  onModelChange,
  claude,
  claudeAuthRequired: claudeAuthState,
  operationErrorMessage,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showClaudeSigninPanel, setShowClaudeSigninPanel] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    uploadedDescriptors,
    isUploading,
    hasPendingOrFailedUploads,
  } = useImageAttachments({
    uploadFile: async (file) => {
      const uploaded = await onUploadAttachments([file]);
      const descriptor = uploaded[0];
      if (!descriptor) {
        throw new Error("Upload succeeded but no attachment descriptor was returned");
      }
      return descriptor;
    },
    deleteAttachment: onDeleteAttachment,
  });
  const isClaudeLoading = claude.loading;
  const isClaudePromptBlocking = showClaudeSigninPanel;

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    if (!claudeAuthState) {
      setShowClaudeSigninPanel(false);
      return;
    }

    setShowClaudeSigninPanel(true);
  }, [claudeAuthState]);

  const handleSubmit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if ((!input.trim() && attachments.length === 0) || disabled || isClaudePromptBlocking || isStreaming)
      return;
    if (hasPendingOrFailedUploads) {
      toast.error("Please wait for all attachments to finish uploading (or remove failed uploads).");
      return;
    }

    const trimmedInput = input.trim();
    onSend({
      content: trimmedInput || undefined,
      attachments: uploadedDescriptors.map((attachment) => ({
        attachmentId: attachment.attachmentId,
      })),
      optimisticAttachments: uploadedDescriptors,
    });
    setInput("");
    clearAttachments();

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.stopPropagation();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSubmit(event);
    }
  };

  return (
    <form
      className="relative"
      onSubmit={(event) => void handleSubmit(event)}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled && !isClaudePromptBlocking) {
          setIsDragging(true);
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (disabled || isClaudePromptBlocking) {
          return;
        }
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {isDragging && (
        <div className="absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-50/60 dark:bg-blue-950/40">
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Release to attach image</span>
        </div>
      )}
      {showClaudeSigninPanel && !isClaudeLoading && (
        <ClaudeSigninPanel
          claude={claude}
          isExiting={false}
        />
      )}
      <ChatAttachmentPreviews
        attachments={attachments}
        onRemove={removeAttachment}
        className="px-4 pt-3"
      />
      {operationErrorMessage && (
        <div className="px-4 pt-3">
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
            {operationErrorMessage}
          </div>
        </div>
      )}

      <div className="px-4 pt-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled || isClaudePromptBlocking
              ? "Waiting for agent to be ready..."
              : "Send a message..."
          }
          disabled={disabled || isClaudePromptBlocking}
          rows={1}
          className="w-full resize-none overflow-hidden bg-transparent px-0 py-1 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      <div className="flex items-center justify-end px-3 pb-2">
        <div className="mr-auto flex items-center gap-1">
          <ImageAttachButton
            onFiles={addFiles}
            disabled={disabled || isClaudePromptBlocking}
          />
        </div>
        <div className="flex items-center gap-1">
          {model && onModelChange && (
            <ModelSelector
              selectedModel={model}
              onSelect={onModelChange}
              disabled={disabled || isClaudePromptBlocking}
            />
          )}
        {isStreaming ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onStop}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-danger text-white hover:bg-danger/90 transition-colors"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Stop generation</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="submit"
                disabled={disabled || isClaudePromptBlocking || hasPendingOrFailedUploads || (!input.trim() && attachments.length === 0)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {isUploading
                ? "Uploading attachments..."
                : hasPendingOrFailedUploads
                  ? "Attachments must finish uploading before send."
                  : "Enter to send. Shift+Enter for new line."}
            </TooltipContent>
          </Tooltip>
        )}
        </div>
      </div>
    </form>
  );
}
