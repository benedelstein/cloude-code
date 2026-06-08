"use client";

import { ArrowUp, Square, Trash2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { cn } from "@/lib/utils";

type SendButtonIcon = "send" | "trash";
type SendButtonVariant = "accent" | "danger" | "muted";

interface SendButtonProps {
  isStreaming: boolean;
  isCancelling?: boolean;
  /** Disables the send button (not applicable in streaming/stop mode). */
  disabled?: boolean;
  /** Shows a spinner and disables the button (e.g. submitting, uploading). */
  isLoading?: boolean;
  isUploading?: boolean;
  hasPendingOrFailedUploads?: boolean;
  hasContent: boolean;
  tooltipOverride?: string;
  icon?: SendButtonIcon;
  variant?: SendButtonVariant;
  onTap: () => void;
}

export function SendButton({
  isStreaming,
  isCancelling = false,
  disabled = false,
  isLoading = false,
  isUploading = false,
  hasPendingOrFailedUploads = false,
  hasContent,
  tooltipOverride,
  icon = "send",
  variant,
  onTap,
}: SendButtonProps) {
  const isActionLoading = isLoading || isCancelling;
  const isSendDisabled = isStreaming
    ? isCancelling
    : disabled || isActionLoading || hasPendingOrFailedUploads || !hasContent;
  const visualVariant = variant ?? (isStreaming ? "danger" : "accent");

  const tooltipText = tooltipOverride ?? (() => {
    if (isCancelling) {
      return "Stopping...";
    }
    if (isStreaming) {
      return "Interrupt";
    }
    if (isActionLoading) {
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
          aria-label={tooltipText}
          disabled={isSendDisabled}
          onClick={onTap}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            visualVariant === "accent" && "bg-accent text-accent-foreground hover:bg-accent-hover",
            visualVariant === "danger" && "bg-danger text-white hover:bg-danger/90",
            visualVariant === "muted" && "bg-muted text-foreground-secondary hover:text-foreground",
          )}
        >
          <div className="relative h-3.5 w-3.5">
            <ArrowUp
              className={cn(
                "absolute inset-0 h-3.5 w-3.5 transition-all duration-150",
                !isStreaming && !isActionLoading && icon === "send"
                  ? "scale-100 opacity-100"
                  : "scale-0 opacity-0",
              )}
            />
            <Square
              className={cn(
                "absolute inset-0 h-3.5 w-3.5 transition-all duration-150",
                isStreaming && !isCancelling ? "scale-100 opacity-100" : "scale-0 opacity-0",
              )}
            />
            <Trash2
              className={cn(
                "absolute inset-0 h-3.5 w-3.5 transition-all duration-150",
                !isStreaming && !isActionLoading && icon === "trash"
                  ? "scale-100 opacity-100"
                  : "scale-0 opacity-0",
              )}
            />
            <LoadingSpinner
              className={cn(
                "absolute inset-0 h-3.5 w-3.5 transition-all duration-150",
                isActionLoading ? "scale-100 opacity-100" : "scale-0 opacity-0",
              )}
            />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
