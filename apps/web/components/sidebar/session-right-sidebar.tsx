"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/components/providers/session-provider";
import { AppRightSidebarPortal } from "@/components/layout/app-right-sidebar-context";
import { getSessionPlan } from "@/lib/client-api";
import { SessionPlanSection } from "@/components/sidebar/session-plan-section";
import { SessionTodoListSection } from "@/components/sidebar/session-todo-list-section";
import {
  SidebarContent,
  SidebarHeader,
  SIDEBAR_HEADER_HEIGHT_CLASS,
  SidebarGroupContent,
  SidebarGroup,
} from "@/components/ui/sidebar";
import type { SessionPlanResponse } from "@repo/shared";

export function SessionRightSidebar() {
  const {
    sessionId,
    repoFullName,
    todos,
    plan: planMetadata,
  } = useSession();
  const [plan, setPlan] = useState<SessionPlanResponse | null>(null);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    if (!planMetadata) {
      setPlan(null);
      setPlanError(null);
      setIsPlanLoading(false);
      return;
    }

    let isCancelled = false;
    setIsPlanLoading(true);
    setPlanError(null);

    (async () => {
      try {
        const plan = await getSessionPlan(sessionId)
        if (isCancelled) {
          return;
        }
        setPlan(plan);
      } catch {
        if (isCancelled) {
          return;
        }
        setPlanError("Failed to load plan.");
      } finally {
        if (!isCancelled) {
          setIsPlanLoading(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [planMetadata?.lastUpdated, sessionId]);

  return (
    <AppRightSidebarPortal>
      <SidebarHeader className={`${SIDEBAR_HEADER_HEIGHT_CLASS} justify-center border-b border-sidebar-border`}>
        <div className="px-2">
          <div className="min-w-0 flex gap-0 flex-col">
            <p className="truncate text-sm font-medium">Session Context</p>
            <Link href={`https://github.com/${repoFullName}`} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-foreground-muted hover:underline">
              {repoFullName ?? "Unknown repository"}
            </Link>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-4 px-0 py-0">
        <SidebarGroup>
          <SidebarGroupContent>
            <SessionTodoListSection todos={todos} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupContent>
            <SessionPlanSection
              plan={plan}
              isLoading={isPlanLoading}
              errorMessage={planError}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </AppRightSidebarPortal>
  );
}
