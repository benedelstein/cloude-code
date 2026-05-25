"use client";

import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { humanizeDuration } from "@/lib/duration";
import { useNow } from "@/lib/use-now";

interface TurnWorkHeaderProps {
  expanded: boolean;
  onToggle: () => void;
  startedAt: number | undefined;
  endedAt: number | undefined;
  isStreaming: boolean;
}

export function TurnWorkHeader({ expanded, onToggle, startedAt, endedAt, isStreaming }: TurnWorkHeaderProps) {
  const tickIntervalMs = isStreaming && startedAt !== undefined && endedAt === undefined
    ? 1000
    : 60_000;
  const now = useNow(tickIntervalMs);

  let label = "Worked";
  if (startedAt !== undefined && endedAt !== undefined) {
    label = `Worked for ${humanizeDuration(endedAt - startedAt)}`;
  } else if (startedAt !== undefined && isStreaming) {
    label = `Working for ${humanizeDuration(now - startedAt)}`;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-fit items-center gap-2 py-1 text-[13px] text-foreground-secondary hover:text-foreground transition-colors text-left rounded cursor-pointer"
      aria-expanded={expanded}
    >
      <span>{label}</span>
      <ChevronRight className={clsx("w-3.5 h-3.5 transition-transform", expanded ? "rotate-90" : "hidden group-hover:block")} />
    </button>
  );
}
