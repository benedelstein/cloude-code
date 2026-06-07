"use client";

import { Mic } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MicButtonProps {
  disabled?: boolean;
  unsupported?: boolean;
  onTap: () => void;
}

export function MicButton({ disabled = false, unsupported = false, onTap }: MicButtonProps) {
  const isDisabled = disabled || unsupported;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={unsupported ? "Voice input unavailable" : "Record voice"}
          disabled={isDisabled}
          onClick={onTap}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Mic className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {unsupported ? "Voice input unavailable" : "Record voice"}
      </TooltipContent>
    </Tooltip>
  );
}
