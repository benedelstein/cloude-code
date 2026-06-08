"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  VOICE_SIGNAL_BAR_COUNT,
  type VoiceInputState,
} from "@/hooks/use-voice-input";

interface VoiceRecordingBarProps {
  state: VoiceInputState;
  className?: string;
}

const MIN_BAR_HEIGHT_PX = 3;
const MAX_BAR_HEIGHT_PX = 28;
const EDGE_ENVELOPE_BAR_COUNT = 4;
const MIN_EDGE_SCALE = 0.45;
const BAR_WIDTH_PX = 2;
const BAR_GAP_PX = 2;

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getEdgeScale(index: number, total: number): number {
  if (total <= 1) {
    return 1;
  }

  const distanceToEdge = Math.min(index, total - 1 - index);
  const progress = Math.min(1, distanceToEdge / EDGE_ENVELOPE_BAR_COUNT);
  const eased = progress * progress * (3 - 2 * progress);
  return MIN_EDGE_SCALE + eased * (1 - MIN_EDGE_SCALE);
}

function getVisibleBarCount(width: number): number {
  if (width <= 0) {
    return VOICE_SIGNAL_BAR_COUNT;
  }

  return Math.max(1, Math.floor((width + BAR_GAP_PX) / (BAR_WIDTH_PX + BAR_GAP_PX)));
}

export function VoiceRecordingBar({
  state,
  className,
}: VoiceRecordingBarProps) {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [visibleBarCount, setVisibleBarCount] = useState(VOICE_SIGNAL_BAR_COUNT);
  const isWorking =
    state.status === "requesting-permission"
    || state.status === "finalizing"
    || state.status === "transcribing";
  const isError = state.status === "error";
  const levels =
    state.levels.length > 0
      ? state.levels
      : Array.from({ length: VOICE_SIGNAL_BAR_COUNT }, () => 0.15);
  const visibleLevels = useMemo(
    () => levels.slice(-visibleBarCount),
    [levels, visibleBarCount],
  );

  useEffect(() => {
    const waveform = waveformRef.current;
    if (!waveform) {
      return;
    }

    const updateVisibleBarCount = () => {
      setVisibleBarCount(getVisibleBarCount(waveform.clientWidth));
    };
    updateVisibleBarCount();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateVisibleBarCount);
    resizeObserver.observe(waveform);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "flex h-8 min-w-0 flex-1 items-center gap-3 overflow-hidden transition-all duration-200 motion-reduce:transition-none",
        className,
      )}
    >
      <div className="w-11 shrink-0 pl-1 text-left text-xs font-medium tabular-nums text-foreground-secondary">
        {formatElapsedTime(state.elapsedMs)}
      </div>

      <div
        ref={waveformRef}
        className="flex h-8 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden"
        aria-hidden="true"
      >
        {visibleLevels.map((level, index) => {
          const edgeScale = getEdgeScale(index, visibleLevels.length);
          const opacity = isWorking ? 0.35 : 1;
          const height = Math.max(
            MIN_BAR_HEIGHT_PX,
            Math.round(level * edgeScale * MAX_BAR_HEIGHT_PX),
          );
          return (
            <span
              key={index}
              className={cn(
                "w-0.5 shrink-0 rounded-full bg-accent/75 transition-[height,opacity] duration-150 ease-out motion-reduce:transition-none",
                isError && "bg-danger/75",
              )}
              style={{
                height: `${height}px`,
                opacity,
              }}
            />
          );
        })}
      </div>

      {isError && (
        <div className="min-w-0 max-w-36 truncate text-xs font-medium text-danger">
          {state.message}
        </div>
      )}
    </div>
  );
}
