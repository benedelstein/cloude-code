"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InputFrameProps {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Shared frame for chat input areas. Renders an inner bordered container
 * for the main content, with an optional footer that appears in a subtle
 * outer container below it.
 */
export function InputFrame({ children, footer, className }: InputFrameProps) {
  if (!footer) {
    return (
      <div
        className={cn(
          "rounded-lg border border-accent/50 bg-background shadow-shadow shadow-xl focus-within:border-accent transition-shadow",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-accent/50 bg-background-secondary shadow-shadow shadow-xl",
        className,
      )}
    >
      <div className="relative z-10 rounded-lg border border-accent/50 bg-background overflow-hidden focus-within:border-accent transition-shadow shadow-shadow shadow-sm m-[-1px]">
        {children}
      </div>
      <div className="px-3 py-2.5">
        {footer}
      </div>
    </div>
  );
}
