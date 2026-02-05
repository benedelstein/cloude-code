"use client";

import { useState } from "react";

interface ReasoningPartProps {
  text: string;
}

export function ReasoningPart({ text }: ReasoningPartProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Show first 100 chars as preview
  const preview = text.length > 100
    ? text.slice(0, 100) + "..."
    : text;

  return (
    <div className="my-2 border border-border/50 rounded-lg overflow-hidden bg-muted/30">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        <div className="w-5 h-5 rounded bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
          <ThinkingIcon />
        </div>
        <span className="text-xs text-muted-foreground flex-1">
          {isExpanded ? "Thinking..." : preview}
        </span>
        <ChevronIcon isExpanded={isExpanded} />
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

function ThinkingIcon() {
  return (
    <svg
      className="w-3 h-3 text-yellow-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  );
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-muted-foreground transition-transform ${
        isExpanded ? "rotate-180" : ""
      }`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
