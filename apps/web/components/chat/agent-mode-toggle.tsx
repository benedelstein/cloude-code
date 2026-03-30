"use client";

import { Code, ScrollText } from "lucide-react";
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
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-foreground-muted hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPlan ? (
            <>
              <ScrollText className="h-4 w-4" />
              <span className="text-xs font-medium">plan</span>
            </>
          ) : (
            <>
              <Code className="h-4 w-4" />
              <span className="text-xs font-medium">edit</span>
            </>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {isPlan
          ? "Plan mode: read-only exploration. Click to switch to edit."
          : "Edit mode: full access. Click to switch to plan."}
      </TooltipContent>
    </Tooltip>
  );
}
