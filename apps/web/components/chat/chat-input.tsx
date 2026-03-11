"use client";

import { useState, useRef, useEffect } from "react";
import { ImagePlus, Send, Square, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import type {
  MessageAttachmentRef,
  AttachmentDescriptor,
} from "@repo/shared";

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
}

export function ChatInput({
  onSend,
  onUploadAttachments,
  onDeleteAttachment,
  onStop,
  disabled = false,
  isStreaming = false,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    attachments,
    error,
    setError,
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

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if ((!input.trim() && attachments.length === 0) || disabled) return;
    if (hasPendingOrFailedUploads) {
      setError("Please wait for all attachments to finish uploading (or remove failed ones).");
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
    setError(null);
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
      {attachments.length > 0 && (
        <div className="px-4 pt-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border ${
                  attachment.status === "error" ? "border-danger" : "border-border"
                }`}
              >
                <img
                  src={attachment.previewUrl}
                  alt={attachment.file.name}
                  className={`h-full w-full object-cover ${
                    attachment.status === "uploading" ? "opacity-60" : ""
                  }`}
                />
                {attachment.status === "uploading" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <LoadingSpinner className="h-4 w-4 text-white" />
                  </div>
                )}
                {attachment.status === "error" && (
                  <div className="absolute left-1 top-1 rounded bg-danger/90 px-1 text-[10px] text-white">
                    Failed
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-foreground-muted hover:text-foreground"
                  aria-label={`Remove ${attachment.file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
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
            disabled
              ? "Waiting for agent to be ready..."
              : isDragging
                ? "Drop images to attach..."
                : "Send a message..."
          }
          disabled={disabled || isStreaming || isUploading}
          rows={1}
          className={`w-full resize-none overflow-hidden bg-transparent px-0 py-1 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
            isDragging ? "opacity-70" : ""
          }`}
        />
      </div>
      {error && (
        <p className="px-4 pb-1 text-xs text-danger">{error}</p>
      )}
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
                disabled={disabled || isStreaming}
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
                disabled={disabled || hasPendingOrFailedUploads || (!input.trim() && attachments.length === 0)}
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
