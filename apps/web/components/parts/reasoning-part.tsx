"use client";

import { Sparkles } from "lucide-react";
import { getPartTiming } from "@repo/shared";
import { humanizeDuration } from "@/lib/duration";
import { useNow } from "@/lib/use-now";
import { ExpandableSummary } from "./expandable-summary";

interface ReasoningPartProps {
  part: { text?: string; startedAt?: unknown; endedAt?: unknown };
  isStreaming?: boolean;
}

export function ReasoningPart({ part, isStreaming }: ReasoningPartProps) {
  const { startedAt, endedAt } = getPartTiming(part);
  const isInFlight = isStreaming && startedAt !== undefined && endedAt === undefined;
  const now = useNow(isInFlight ? 1000 : 60_000);

  let label: string;
  if (isInFlight) {
    label = "Thinking…";
  } else if (startedAt !== undefined && endedAt !== undefined) {
    label = `Thought for ${humanizeDuration(endedAt - startedAt)}`;
  } else if (startedAt !== undefined && isStreaming) {
    label = `Thinking for ${humanizeDuration(now - startedAt)}`;
  } else {
    label = "Thought";
  }

  const text = part.text ?? "";

  return (
    <ExpandableSummary
      icon={<Sparkles className="w-3.5 h-3.5" />}
      summary={<span className="text-foreground-secondary italic">{label}</span>}
      detail={
        text.length > 0
          ? <p className="my-1 text-sm text-foreground-secondary whitespace-pre-wrap">{text}</p>
          : undefined
      }
    />
  );
}
