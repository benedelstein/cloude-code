"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { ChatAttachmentPreviews } from "@/components/chat/chat-attachment-previews";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { ProviderSigninPanel } from "@/components/model-providers/provider-signin-panel";
import { ProviderModelEffortSelector } from "@/components/model-providers/provider-model-effort-selector";
import {
  PROVIDERS,
  type AgentMode,
  type MessageAttachmentRef,
  type AttachmentDescriptor,
  type ProviderAuthRequired,
  type ProviderId,
} from "@repo/shared";
import type { ProviderAuthHandleUnion } from "@/hooks/use-provider-auth";
import { ImageAttachButton } from "@/components/chat/image-attach-button";
import { AgentModeToggle } from "@/components/chat/agent-mode-toggle";
import { VoiceComposerControls } from "@/components/chat/voice-composer-controls";
import { VoiceRecordingBar } from "@/components/chat/voice-recording-bar";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { toast } from "sonner";

interface ChatInputProps {
  onSend: (message: {
    content?: string;
    attachments?: MessageAttachmentRef[];
    optimisticAttachments?: AttachmentDescriptor[];
  }) => void;
  onUploadAttachments: (files: File[]) => Promise<AttachmentDescriptor[]>;
  onDeleteAttachment: (attachmentId: string) => Promise<void>;
  onStop: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  agentMode?: AgentMode;
  onAgentModeChange?: (mode: AgentMode) => void;
  selectedProvider: ProviderId | null;
  selectedModel: string | null;
  selectedEffort: string | null;
  onProviderModelChange?: (providerId: ProviderId, modelId: string) => void;
  onProviderEffortChange?: (providerId: ProviderId, effortId: string) => void;
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
  selectedEffort,
  onProviderModelChange,
  onProviderEffortChange,
  providerAuthHandles,
  providerAuthRequired,
  operationErrorMessage,
  disabledPlaceholder = "Waiting for agent to be ready...",
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [manuallyOpenedSigninPanel, setManuallyOpenedSigninPanel] = useState(false);
  const [dismissedAuthRequiredKey, setDismissedAuthRequiredKey] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
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

  const providerAuthRequiredKey = providerAuthRequired
    ? `${providerAuthRequired.providerId}:${providerAuthRequired.state}`
    : null;
  const signinProviderId = providerAuthRequired?.providerId ?? selectedProvider;
  const signinHandle = signinProviderId
    ? providerAuthHandles.find((handle) => handle.providerId === signinProviderId)
    : undefined;
  const isAuthBlocking = providerAuthRequired !== null && Boolean(signinProviderId && signinHandle);
  const shouldShowRequiredSigninPanel = providerAuthRequired !== null
    && providerAuthRequiredKey !== dismissedAuthRequiredKey;
  // Open when the session requires auth, unless the user dismissed that exact
  // auth-required state, or when the user manually reopens it from the picker.
  const showSigninPanel = Boolean(signinHandle)
    && (shouldShowRequiredSigninPanel || manuallyOpenedSigninPanel);
  const authRequiredLabel = signinProviderId
    ? `Reconnect ${PROVIDERS[signinProviderId].displayName} to continue`
    : "Reconnect provider to continue";

  useEffect(() => {
    if (providerAuthRequiredKey === null) {
      setDismissedAuthRequiredKey(null);
      setManuallyOpenedSigninPanel(false);
      return;
    }

    setDismissedAuthRequiredKey((current) => (
      current !== null && current !== providerAuthRequiredKey ? null : current
    ));
  }, [providerAuthRequiredKey]);

  useEffect(() => {
    if (!isStreaming) {
      setIsCancelling(false);
    }
  }, [isStreaming]);

  const insertVoiceTranscript = useCallback((text: string) => {
    setInput((current) => current ? `${current}\n${text}` : text);
  }, []);

  const sendVoiceTranscript = useCallback((text: string) => {
    const transcript = text.trim();
    if (!transcript) {
      return;
    }

    const combinedInput = [input.trim(), transcript].filter(Boolean).join("\n");
    if (disabled || isAuthBlocking || isStreaming) {
      setInput((current) => current ? `${current}\n${transcript}` : transcript);
      return;
    }
    if (hasPendingOrFailedUploads) {
      toast.error("Please wait for all attachments to finish uploading (or remove failed uploads).");
      setInput(combinedInput);
      return;
    }

    onSend({
      content: combinedInput || undefined,
      attachments: uploadedDescriptors.map((attachment) => ({
        attachmentId: attachment.attachmentId,
      })),
      optimisticAttachments: uploadedDescriptors,
    });
    setInput("");
    clearAttachments();

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [
    clearAttachments,
    disabled,
    hasPendingOrFailedUploads,
    input,
    isAuthBlocking,
    isStreaming,
    onSend,
    uploadedDescriptors,
  ]);

  const voiceInput = useVoiceInput({
    onInsertTranscript: insertVoiceTranscript,
    onSendTranscript: sendVoiceTranscript,
  });

  const submitMessage = () => {
    if (
      (!input.trim() && attachments.length === 0)
      || disabled
      || isAuthBlocking
      || isStreaming
      || voiceInput.isActive
    )
      { return; }
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

  const reopenSigninPanel = () => {
    setDismissedAuthRequiredKey(null);
    setManuallyOpenedSigninPanel(true);
  };

  const handleStop = () => {
    if (isCancelling) {
      return;
    }
    setIsCancelling(true);
    onStop();
  };

  return (
    <form
      className="relative"
      onSubmit={(event) => void handleSubmit(event)}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) {
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
        if (disabled) {
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
          onOpenChange={(open) => {
            if (open) {
              return;
            }
            setManuallyOpenedSigninPanel(false);
            if (providerAuthRequiredKey !== null) {
              setDismissedAuthRequiredKey(providerAuthRequiredKey);
            }
          }}
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
            disabled
              ? disabledPlaceholder
              : "Send a message..."
          }
          disabled={disabled}
          rows={1}
          className="w-full resize-none overflow-y-auto bg-transparent px-0 py-1 text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
      <div className="flex min-w-0 items-center gap-2 px-3 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {voiceInput.isActive ? (
            <VoiceRecordingBar state={voiceInput.state} />
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2">
                <ImageAttachButton
                  onFiles={addFiles}
                  disabled={disabled}
                />
                {agentMode && onAgentModeChange && (
                  <AgentModeToggle
                    agentMode={agentMode}
                    onToggle={() => onAgentModeChange(agentMode === "plan" ? "edit" : "plan")}
                    disabled={disabled}
                  />
                )}
              </div>
              <div className="ml-auto flex min-w-0 items-center justify-end">
                {selectedProvider
                  && selectedModel
                  && selectedEffort
                  && onProviderModelChange
                  && onProviderEffortChange && (
                  <ProviderModelEffortSelector
                    selectedProvider={selectedProvider}
                    selectedModel={selectedModel}
                    selectedEffort={selectedEffort}
                    providerAuthHandles={providerAuthHandles}
                    onModelSelect={onProviderModelChange}
                    onEffortSelect={onProviderEffortChange}
                    onConnect={reopenSigninPanel}
                    allowedProviderIds={[selectedProvider]}
                    disabled={disabled}
                    authRequired={isAuthBlocking}
                    authRequiredLabel={authRequiredLabel}
                    onAuthRequiredClick={reopenSigninPanel}
                    className="gap-0"
                  />
                )}
              </div>
            </>
          )}
        </div>
        <VoiceComposerControls
          voiceInput={voiceInput}
          micDisabled={disabled || isAuthBlocking || isStreaming}
          submitDisabled={disabled || isAuthBlocking}
          isStreaming={isStreaming}
          isCancelling={isCancelling}
          isUploading={isUploading}
          hasPendingOrFailedUploads={hasPendingOrFailedUploads}
          hasContent={Boolean(input.trim()) || attachments.length > 0}
          onSubmit={submitMessage}
          onStop={handleStop}
        />
      </div>
    </form>
  );
}
