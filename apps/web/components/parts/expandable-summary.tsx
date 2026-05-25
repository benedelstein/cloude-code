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
  variant?: "tool" | "plain";
  className?: string;
}

export function ExpandableSummary({
  icon,
  summary,
  status,
  detail,
  defaultExpanded = false,
  disabled,
  variant = "tool",
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
          "group w-fit max-w-full flex items-center gap-2 py-1 text-left transition-colors",
          variant === "tool" && clsx(
            "text-[13px]",
            canExpand && expanded
              ? "text-foreground"
              : "text-foreground-secondary hover:text-foreground",
          ),
          variant === "plain" && clsx(
            "text-[13px] transition-colors",
            canExpand && expanded
              ? "text-foreground"
              : "text-foreground-secondary",
          ),
          canExpand && "cursor-pointer",
          !canExpand && "cursor-default",
          canExpand && variant === "plain" && "hover:text-foreground",
        )}
        aria-expanded={canExpand ? expanded : undefined}
        disabled={!canExpand}
      >
        {icon && (
          <span className="shrink-0 w-4 h-4 flex items-center justify-center text-current">
            {icon}
          </span>
        )}
        <span className="min-w-0 truncate">{summary}</span>
        {status && (
          <span className="shrink-0 text-xs text-current">{status}</span>
        )}
        {canExpand && (
          <ChevronRight
            className={clsx(
              "w-3.5 h-3.5 shrink-0 text-current transition-transform",
              expanded ? "rotate-90" : "hidden group-hover:block",
            )}
          />
        )}
      </button>
      {canExpand && (
        <div
          className={clsx(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden min-h-0">
            <div className={clsx("text-sm min-w-0", expanded && "mt-1 mb-2")}>{detail}</div>
          </div>
        </div>
      )}
    </div>
  );
}
