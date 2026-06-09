"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionPlanResponse } from "@repo/shared";

export function SessionRightSidebar() {
  const {
    sessionId,
    hasHydratedState,
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

    void (async () => {
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
    <SessionRightSidebarFrame
      headerDetail={hasHydratedState ? (
        repoFullName ? (
          <Link href={`https://github.com/${repoFullName}`} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-foreground-secondary hover:underline">
            {repoFullName}
          </Link>
        ) : (
          <p className="truncate text-xs text-foreground-secondary">Unknown repository</p>
        )
      ) : (
        <Skeleton className="mt-1 h-3 w-32" />
      )}
      todoSection={<SessionTodoListSection isLoading={!hasHydratedState} todos={todos} />}
      planSection={(
        <SessionPlanSection
          isHydrated={hasHydratedState}
          plan={plan}
          isLoading={isPlanLoading}
          errorMessage={planError}
        />
      )}
    />
  );
}

export function SessionRightSidebarLoading() {
  return (
    <SessionRightSidebarFrame
      headerDetail={<Skeleton className="mt-1 h-3 w-32" />}
      todoSection={<SessionTodoListSection isLoading todos={null} />}
      planSection={(
        <SessionPlanSection
          isHydrated={false}
          plan={null}
          isLoading={false}
          errorMessage={null}
        />
      )}
    />
  );
}

function SessionRightSidebarFrame({
  headerDetail,
  todoSection,
  planSection,
}: {
  headerDetail: ReactNode;
  todoSection: ReactNode;
  planSection: ReactNode;
}) {
  return (
    <AppRightSidebarPortal>
      <SidebarHeader className={`${SIDEBAR_HEADER_HEIGHT_CLASS} justify-center`}>
        <div className="px-1">
          <div className="min-w-0 flex gap-0 flex-col">
            <p className="truncate text-sm font-medium">Session Context</p>
            {headerDetail}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-4 px-0 py-0">
        <SidebarGroup>
          <SidebarGroupContent>
            {todoSection}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupContent>
            {planSection}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </AppRightSidebarPortal>
  );
}
