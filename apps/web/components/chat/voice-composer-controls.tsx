"use client";

import { Trash2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UseVoiceInputResult } from "@/hooks/use-voice-input";
import { MicButton } from "@/components/chat/mic-button";
import { SendButton } from "@/components/chat/send-button";

interface VoiceComposerControlsProps {
  voiceInput: UseVoiceInputResult;
  micDisabled?: boolean;
  submitDisabled?: boolean;
  isStreaming?: boolean;
  isCancelling?: boolean;
  interruptDisabled?: boolean;
  isLoading?: boolean;
  isUploading?: boolean;
  hasPendingOrFailedUploads?: boolean;
  hasContent: boolean;
  className?: string;
  onSubmit: () => void;
  onStop?: () => void;
}

function VoiceDiscardButton({ onTap }: { onTap: () => void }) {
  const label = "Discard recording";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onTap}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground-secondary transition-colors hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function VoiceComposerControls({
  voiceInput,
  micDisabled = false,
  submitDisabled = false,
  isStreaming = false,
  isCancelling = false,
  interruptDisabled = false,
  isLoading = false,
  isUploading = false,
  hasPendingOrFailedUploads = false,
  hasContent,
  className,
  onSubmit,
  onStop,
}: VoiceComposerControlsProps) {
  const voiceStatus = voiceInput.state.status;
  const isVoiceRecording = voiceStatus === "recording";
  const isVoiceWorking =
    voiceStatus === "finalizing"
    || voiceStatus === "transcribing";
  const isVoiceError = voiceStatus === "error";
  const canRetryVoice = voiceInput.state.status === "error" && voiceInput.state.canRetry;
  const isVoiceMicDisabled =
    micDisabled
    || voiceStatus === "requesting-permission"
    || (isVoiceError && !canRetryVoice);
  const voiceMicMode = isVoiceWorking
    ? "loading"
    : isVoiceRecording
      ? "stop"
      : canRetryVoice
        ? "retry"
        : "record";
  const voiceMicLabel = (() => {
    if (!voiceInput.isSupported) {
      return "Voice input unavailable";
    }
    if (isVoiceWorking) {
      return "Transcribing audio...";
    }
    if (isVoiceRecording) {
      return "Stop and transcribe";
    }
    if (isVoiceError) {
      return canRetryVoice ? "Retry transcription" : "Voice recording unavailable";
    }
    return "Record voice";
  })();
  const sendTooltipOverride = (() => {
    if (isVoiceRecording) {
      return "Transcribe and send";
    }
    if (isVoiceWorking) {
      return "Transcribing audio...";
    }
    return undefined;
  })();

  const handleVoiceMicTap = () => {
    if (isVoiceRecording) {
      void voiceInput.stopAndInsert();
      return;
    }
    if (isVoiceError) {
      if (!canRetryVoice) {
        return;
      }
      void voiceInput.retryLast();
      return;
    }
    void voiceInput.startRecording();
  };

  const handleSendTap = () => {
    if (isStreaming) {
      if (interruptDisabled) {
        return;
      }
      onStop?.();
      return;
    }
    if (isVoiceRecording) {
      void voiceInput.stopAndSend();
      return;
    }
    onSubmit();
  };

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <MicButton
        disabled={isVoiceMicDisabled}
        unsupported={!voiceInput.isSupported}
        mode={voiceMicMode}
        label={voiceMicLabel}
        onTap={handleVoiceMicTap}
      />
      {isVoiceError && !isStreaming ? (
        <VoiceDiscardButton onTap={() => void voiceInput.discardDraft()} />
      ) : (
        <SendButton
          isStreaming={isStreaming}
          isCancelling={isCancelling}
          interruptDisabled={interruptDisabled}
          isLoading={isLoading}
          isUploading={isUploading}
          disabled={submitDisabled || (voiceInput.isActive && isVoiceWorking)}
          hasPendingOrFailedUploads={!voiceInput.isActive && hasPendingOrFailedUploads}
          hasContent={voiceInput.isActive || hasContent}
          tooltipOverride={sendTooltipOverride}
          onTap={handleSendTap}
        />
      )}
    </div>
  );
}
