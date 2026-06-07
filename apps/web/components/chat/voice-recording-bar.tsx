"use client";

import { ArrowUp, RotateCcw, Square, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { VoiceInputState } from "@/hooks/use-voice-input";

interface VoiceRecordingBarProps {
  state: VoiceInputState;
  onStop: () => void;
  onSend: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  disabled?: boolean;
  className?: string;
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function RecordingActionButton({
  label,
  disabled,
  onClick,
  children,
  variant = "muted",
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  variant?: "muted" | "accent" | "danger";
}) {
  const className = cn(
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    variant === "muted" && "bg-muted text-foreground-secondary hover:text-foreground",
    variant === "accent" && "bg-accent text-accent-foreground hover:bg-accent-hover",
    variant === "danger" && "bg-danger text-white hover:bg-danger/90",
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={className}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function VoiceRecordingBar({
  state,
  onStop,
  onSend,
  onRetry,
  onDiscard,
  disabled = false,
  className,
}: VoiceRecordingBarProps) {
  const isWorking =
    state.status === "requesting-permission"
    || state.status === "finalizing"
    || state.status === "transcribing";
  const isRecording = state.status === "recording";
  const isError = state.status === "error";
  const levels = state.levels.length > 0 ? state.levels : Array.from({ length: 28 }, () => 0.15);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-background px-2 py-1.5 transition-all duration-200 motion-reduce:transition-none",
        isRecording && "border-accent/40 bg-accent/5",
        isError && "border-danger/30 bg-danger/10",
        className,
      )}
    >
      <div className="w-11 shrink-0 text-right text-xs font-medium tabular-nums text-foreground-secondary">
        {formatElapsedTime(state.elapsedMs)}
      </div>

      <div
        className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden"
        aria-hidden="true"
      >
        {levels.map((level, index) => (
          <span
            key={index}
            className={cn(
              "w-1 rounded-full bg-accent/70 transition-[height,opacity] duration-100 motion-reduce:transition-none",
              isError && "bg-danger/70",
              isWorking && "opacity-50",
            )}
            style={{ height: `${Math.max(4, Math.round(level * 28))}px` }}
          />
        ))}
      </div>

      {isError && (
        <div className="min-w-0 max-w-36 truncate text-xs font-medium text-danger">
          {state.message}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {isRecording && (
          <>
            <RecordingActionButton
              label="Stop recording"
              disabled={disabled}
              onClick={onStop}
              variant="danger"
            >
              <Square className="h-3.5 w-3.5" />
            </RecordingActionButton>
            <RecordingActionButton
              label="Send recording"
              disabled={disabled}
              onClick={onSend}
              variant="accent"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </RecordingActionButton>
          </>
        )}

        {isWorking && (
          <RecordingActionButton label="Please wait" disabled onClick={() => undefined}>
            <LoadingSpinner className="h-3.5 w-3.5" />
          </RecordingActionButton>
        )}

        {isError && (
          <>
            <RecordingActionButton
              label="Retry transcription"
              disabled={disabled || !state.canRetry}
              onClick={onRetry}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </RecordingActionButton>
            <RecordingActionButton
              label="Discard recording"
              disabled={disabled}
              onClick={onDiscard}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </RecordingActionButton>
          </>
        )}
      </div>
    </div>
  );
}
