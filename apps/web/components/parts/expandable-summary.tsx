"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";

interface ExpandableSummaryProps {
  icon?: ReactNode;
  /** The single-line summary text (or any inline content). */
  summary: ReactNode;
  /** Optional right-aligned status text/element (e.g. duration, status). */
  status?: ReactNode;
  /** When provided, renders the expandable detail panel under the summary row. */
  detail?: ReactNode;
  defaultExpanded?: boolean;
  /** Disables the expand chevron when no detail is provided. */
  disabled?: boolean;
  className?: string;
}

export function ExpandableSummary({
  icon,
  summary,
  status,
  detail,
  defaultExpanded = false,
  disabled,
  className,
}: ExpandableSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const canExpand = !disabled && detail !== undefined && detail !== null && detail !== false;
  return (
    <div className={clsx("my-1 min-w-0", className)}>
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        className={clsx(
          "w-fit max-w-full flex items-center gap-2 px-2 py-1 rounded text-left text-sm",
          canExpand
            ? clsx("cursor-pointer", expanded ? "bg-muted/70" : "hover:bg-muted/55")
            : "cursor-default",
        )}
        aria-expanded={canExpand ? expanded : undefined}
        disabled={!canExpand}
      >
        {icon && (
          <span className="shrink-0 w-4 h-4 flex items-center justify-center text-foreground-muted">
            {icon}
          </span>
        )}
        <span className="min-w-0 truncate">{summary}</span>
        {status && (
          <span className="shrink-0 text-xs text-foreground-muted">{status}</span>
        )}
        {canExpand && (
          <ChevronRight
            className={clsx(
              "w-3.5 h-3.5 shrink-0 text-foreground-muted transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
      </button>
      {canExpand && expanded && (
        <div className="mt-1 mb-2 text-sm min-w-0 overflow-hidden">
          {detail}
        </div>
      )}
    </div>
  );
}
