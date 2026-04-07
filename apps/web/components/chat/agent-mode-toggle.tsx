"use client";

import { CodeXml, ScrollText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentMode } from "@repo/shared";

interface AgentModeToggleProps {
  agentMode: AgentMode;
  onToggle: () => void;
  disabled?: boolean;
}

export function AgentModeToggle({ agentMode, onToggle, disabled }: AgentModeToggleProps) {
  const isPlan = agentMode === "plan";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={onToggle}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
            isPlan
              ? "bg-[var(--plan-subtle)] text-[var(--plan)] hover:bg-[var(--plan-subtle-strong)] focus-visible:bg-[var(--plan-subtle-strong)]"
              : "bg-[var(--edit-subtle)] text-[var(--edit)] hover:bg-[var(--edit-subtle-strong)] focus-visible:bg-[var(--edit-subtle-strong)]"
          }`}
        >
          {isPlan ? (
            <>
              <ScrollText className="h-4 w-4" />
              <span className="text-xs font-medium">Plan</span>
            </>
          ) : (
            <>
              <CodeXml className="h-4 w-4" />
              <span className="text-xs font-medium">Edit</span>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {isPlan
          ? "Plan mode: read-only exploration"
          : "Edit mode: full access"}
      </TooltipContent>
    </Tooltip>
  );
}
