"use client";

import { cn } from "@/lib/utils";
import type { VoiceInputState } from "@/hooks/use-voice-input";

interface VoiceRecordingBarProps {
  state: VoiceInputState;
  className?: string;
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function VoiceRecordingBar({
  state,
  className,
}: VoiceRecordingBarProps) {
  const isWorking =
    state.status === "requesting-permission"
    || state.status === "finalizing"
    || state.status === "transcribing";
  const isError = state.status === "error";
  const levels = state.levels.length > 0 ? state.levels : Array.from({ length: 28 }, () => 0.15);

  return (
    <div
      className={cn(
        "flex h-8 min-w-0 flex-1 items-center gap-3 overflow-hidden transition-all duration-200 motion-reduce:transition-none",
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
    </div>
  );
}
