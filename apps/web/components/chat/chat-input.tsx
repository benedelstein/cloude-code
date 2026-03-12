"use client";

import { useState, useRef, useEffect } from "react";
import { ImagePlus, Send, Square } from "lucide-react";
import { ChatAttachmentPreviews } from "@/components/chat/chat-attachment-previews";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import type { useClaudeAuth } from "@/hooks/use-claude-auth";
import { ClaudeSigninPanel } from "@/app/(app)/claude-signin-panel";
import type {
  MessageAttachmentRef,
  AttachmentDescriptor,
  ClaudeAuthState,
} from "@repo/shared";
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
  claude: ClaudeAuth;
  claudeAuthRequired: ClaudeAuthState | null;
}

export function ChatInput({
  onSend,
  onUploadAttachments,
  onDeleteAttachment,
  onStop,
  disabled = false,
  isStreaming = false,
  claude,
  claudeAuthRequired: claudeAuthState,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showClaudeSigninPanel, setShowClaudeSigninPanel] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    if ((!input.trim() && attachments.length === 0) || disabled || isClaudePromptBlocking) return;
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
      onSubmit={(event) => void handleSubmit(event)}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled && !isStreaming) {
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
        if (disabled || isStreaming) {
          return;
        }
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
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

      <div className="px-4 pt-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled || isClaudePromptBlocking
              ? "Waiting for agent to be ready..."
              : isDragging
                ? "Drop images to attach..."
                : "Send a message..."
          }
          disabled={disabled || isClaudePromptBlocking || isStreaming || isUploading}
          rows={1}
          className={`w-full resize-none overflow-hidden bg-transparent px-0 py-1 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
            isDragging ? "opacity-70" : ""
          }`}
        />
      </div>
      <div className="flex items-center justify-end px-3 pb-2">
        <div className="mr-auto flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled || isClaudePromptBlocking || isStreaming}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Add images</TooltipContent>
          </Tooltip>
        </div>
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
                <Send className="h-3.5 w-3.5" />
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
    </form>
  );
}
