"use client";

import { FileText, Loader2 } from "lucide-react";
import type { SessionPlanResponse } from "@repo/shared";
import {
  SessionSidebarCard,
  SessionSidebarSection,
} from "@/components/sidebar/session-sidebar-section";

interface SessionPlanSectionProps {
  plan: SessionPlanResponse | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export function SessionPlanSection({
  plan,
  isLoading,
  errorMessage,
}: SessionPlanSectionProps) {
  const minHeight = "min-h-[200px]";
  if (errorMessage) {
    return (
      <SessionSidebarSection title="Plan">
        <SessionSidebarCard variant="empty" className={minHeight}>
          {errorMessage}
        </SessionSidebarCard>
      </SessionSidebarSection>
    );
  }

  if (!isLoading && !plan) {
    return (
      <SessionSidebarSection title="Plan">
        <SessionSidebarCard variant="empty" className={minHeight}>
          No plan for this session.
        </SessionSidebarCard>
      </SessionSidebarSection>
    );
  }

  return (
    <SessionSidebarSection title="Plan">
      <SessionSidebarCard className={minHeight}>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading plan...</span>
          </div>
        ) : plan ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="rounded-md bg-foreground/10 p-1.5 text-foreground-muted">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Latest plan</p>
                <p className="text-xs text-foreground-muted">
                  {new Date(plan.updatedAt).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-dashed border-border bg-background p-3">
              <pre className="whitespace-pre-wrap wrap-break-word text-xs text-foreground-muted">
                {plan.plan}
              </pre>
            </div>
          </div>
        ) : null}
      </SessionSidebarCard>
    </SessionSidebarSection>
  );
}
