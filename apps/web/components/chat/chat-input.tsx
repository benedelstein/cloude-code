"use client";

import { useState, useRef, useEffect } from "react";
import { ChatAttachmentPreviews } from "@/components/chat/chat-attachment-previews";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { ProviderSigninPanel } from "@/components/model-providers/provider-signin-panel";
import { ProviderModelSelector } from "@/components/model-providers/provider-model-selector";
import type {
  AgentMode,
  MessageAttachmentRef,
  AttachmentDescriptor,
  ProviderAuthRequired,
  ProviderId,
} from "@repo/shared";
import type { ProviderAuthHandleUnion } from "@/hooks/use-provider-auth";
import { ImageAttachButton } from "@/components/chat/image-attach-button";
import { AgentModeToggle } from "@/components/chat/agent-mode-toggle";
import { SendButton } from "@/components/chat/send-button";
import { toast } from "sonner";

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
  agentMode?: AgentMode;
  // eslint-disable-next-line no-unused-vars
  onAgentModeChange?: (mode: AgentMode) => void;
  selectedProvider: ProviderId | null;
  selectedModel: string | null;
  // eslint-disable-next-line no-unused-vars
  onProviderModelChange?: (providerId: ProviderId, modelId: string) => void;
  providerAuthHandles: ProviderAuthHandleUnion[];
  providerAuthRequired: ProviderAuthRequired;
  operationErrorMessage?: string | null;
  disabledPlaceholder?: string;
}

export function ChatInput({
  onSend,
  onUploadAttachments,
  onDeleteAttachment,
  onStop,
  disabled = false,
  isStreaming = false,
  agentMode,
  onAgentModeChange,
  selectedProvider,
  selectedModel,
  onProviderModelChange,
  providerAuthHandles,
  providerAuthRequired,
  operationErrorMessage,
  disabledPlaceholder = "Waiting for agent to be ready...",
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showSigninPanel, setShowSigninPanel] = useState(false);
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

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const signinProviderId = providerAuthRequired?.providerId ?? selectedProvider;
  const signinHandle = signinProviderId
    ? providerAuthHandles.find((handle) => handle.providerId === signinProviderId)
    : undefined;
  const isAuthBlocking = showSigninPanel && Boolean(signinProviderId && signinHandle);

  // Show the auth panel automatically when the session provider requires auth.
  useEffect(() => {
    if (!providerAuthRequired) {
      return;
    }
    setShowSigninPanel(true);
  }, [providerAuthRequired]);

  useEffect(() => {
    if (!signinHandle) {
      setShowSigninPanel(false);
      return;
    }

    if (signinHandle.connected && !signinHandle.requiresReauth) {
      setShowSigninPanel(false);
    }
  }, [
    signinHandle?.connected,
    signinHandle?.providerId,
    signinHandle?.requiresReauth,
  ]);

  const submitMessage = () => {
    if ((!input.trim() && attachments.length === 0) || disabled || isAuthBlocking || isStreaming)
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

  const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    submitMessage();
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
        if (!disabled && !isAuthBlocking) {
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
        if (disabled || isAuthBlocking) {
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
      {showSigninPanel && signinProviderId && signinHandle && (
        <ProviderSigninPanel
          providerId={signinProviderId}
          handle={signinHandle}
          open={showSigninPanel}
          onOpenChange={setShowSigninPanel}
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
            disabled || isAuthBlocking
              ? disabledPlaceholder
              : "Send a message..."
          }
          disabled={disabled || isAuthBlocking}
          rows={1}
          className="w-full resize-none overflow-hidden bg-transparent px-0 py-1 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      <div className="flex items-center justify-end px-3 pb-2">
        <div className="mr-auto flex items-center gap-2">
          <ImageAttachButton
            onFiles={addFiles}
            disabled={disabled || isAuthBlocking}
          />
          {agentMode && onAgentModeChange && (
            <AgentModeToggle
              agentMode={agentMode}
              onToggle={() => onAgentModeChange(agentMode === "plan" ? "edit" : "plan")}
              disabled={disabled || isAuthBlocking}
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          {selectedProvider && selectedModel && onProviderModelChange && (
            <ProviderModelSelector
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              providerAuthHandles={providerAuthHandles}
              onSelect={onProviderModelChange}
              onConnect={() => setShowSigninPanel(true)}
              allowedProviderIds={[selectedProvider]}
              disabled={disabled || isAuthBlocking}
            />
          )}
        <SendButton
          isStreaming={isStreaming}
          disabled={disabled || isAuthBlocking}
          isUploading={isUploading}
          hasPendingOrFailedUploads={hasPendingOrFailedUploads}
          hasContent={Boolean(input.trim()) || attachments.length > 0}
          onTap={isStreaming ? onStop : submitMessage}
        />
        </div>
      </div>
    </form>
  );
}
