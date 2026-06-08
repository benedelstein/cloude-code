"use client";

import { Mic, RotateCcw, Square } from "lucide-react";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type MicButtonMode = "record" | "stop" | "loading" | "retry";

interface MicButtonProps {
  disabled?: boolean;
  unsupported?: boolean;
  mode?: MicButtonMode;
  label?: string;
  onTap: () => void;
}

export function MicButton({
  disabled = false,
  unsupported = false,
  mode = "record",
  label,
  onTap,
}: MicButtonProps) {
  const isLoading = mode === "loading";
  const isDisabled = disabled || unsupported || isLoading;
  const tooltipText = label ?? (unsupported ? "Voice input unavailable" : "Record voice");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltipText}
          disabled={isDisabled}
          onClick={onTap}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="relative h-4 w-4">
            <Mic
              className={cn(
                "absolute inset-0 h-4 w-4 transition-all duration-150 motion-reduce:transition-none",
                mode === "record" ? "scale-100 opacity-100" : "scale-0 opacity-0",
              )}
            />
            <Square
              className={cn(
                "absolute inset-0 h-4 w-4 transition-all duration-150 motion-reduce:transition-none",
                mode === "stop" ? "scale-100 opacity-100" : "scale-0 opacity-0",
              )}
            />
            <RotateCcw
              className={cn(
                "absolute inset-0 h-4 w-4 transition-all duration-150 motion-reduce:transition-none",
                mode === "retry" ? "scale-100 opacity-100" : "scale-0 opacity-0",
              )}
            />
            <LoadingSpinner
              className={cn(
                "absolute inset-0 h-4 w-4 transition-all duration-150 motion-reduce:transition-none",
                isLoading ? "scale-100 opacity-100" : "scale-0 opacity-0",
              )}
            />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
