"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SessionSidebarSectionProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}

export function SessionSidebarSection({
  title,
  meta,
  children,
}: SessionSidebarSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs font-medium text-foreground-muted">{title}</p>
        {meta ? (
          <div className="text-[12px] text-foreground-tertiary">{meta}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SessionSidebarCard({
  variant = "default",
  className,
  children,
}: {
  variant?: "default" | "empty";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl p-3",
        variant === "default"
          ? "border border-sidebar-border bg-background-secondary"
          : "border border-dashed border-border bg-background-secondary text-center text-sm text-foreground-muted flex flex-col items-center justify-center",
        className,
      )}
    >
      {children}
    </section>
  );
}