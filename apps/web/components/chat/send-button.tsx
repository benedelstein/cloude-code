"use client";

import { ArrowUp, Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

interface SendButtonProps {
  isStreaming: boolean;
  /** Disables the send button (not applicable in streaming/stop mode). */
  disabled?: boolean;
  /** Shows a spinner and disables the button (e.g. submitting, uploading). */
  isLoading?: boolean;
  isUploading?: boolean;
  hasPendingOrFailedUploads?: boolean;
  hasContent: boolean;
  onTap: () => void;
}

export function SendButton({
  isStreaming,
  disabled = false,
  isLoading = false,
  isUploading = false,
  hasPendingOrFailedUploads = false,
  hasContent,
  onTap,
}: SendButtonProps) {
  const isSendDisabled = !isStreaming && (disabled || isLoading || hasPendingOrFailedUploads || !hasContent);

  const tooltipText = (() => {
    if (isStreaming) {
      return "Interrupt";
    }
    if (isLoading) {
      return isUploading ? "Uploading attachments..." : "Please wait...";
    }
    if (hasPendingOrFailedUploads) {
      return "Attachments must finish uploading before send.";
    }
    return "Enter to send. Shift+Enter for new line.";
  })();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={isSendDisabled}
          onClick={onTap}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isStreaming
              ? "bg-danger text-white hover:bg-danger/90"
              : "bg-accent text-accent-foreground hover:bg-accent-hover"
          }`}
        >
          <div className="relative h-3.5 w-3.5">
            <ArrowUp className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${!isStreaming && !isLoading ? "scale-100 opacity-100" : "scale-0 opacity-0"}`} />
            <Square className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${isStreaming ? "scale-100 opacity-100" : "scale-0 opacity-0"}`} />
            <LoadingSpinner className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${!isStreaming && isLoading ? "scale-100 opacity-100" : "scale-0 opacity-0"}`} />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
