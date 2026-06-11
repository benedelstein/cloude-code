"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSession } from "@/components/providers/session-provider";
import { AppRightSidebarPortal } from "@/components/layout/app-right-sidebar-context";
import { getSessionPlan } from "@/lib/client-api";
import { SessionGitSection } from "@/components/sidebar/session-git-section";
import { SessionPlanSection } from "@/components/sidebar/session-plan-section";
import { SessionSidebarCard } from "@/components/sidebar/session-sidebar-section";
import { SessionTodoListSection } from "@/components/sidebar/session-todo-list-section";
import {
  SidebarHeader,
  SIDEBAR_HEADER_HEIGHT_CLASS,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionPlanResponse } from "@repo/shared";

const SessionTerminal = dynamic(
  () => import("@/components/terminal/session-terminal"),
  { ssr: false },
);

const ACTIVE_TAB_STORAGE_KEY = "session-right-sidebar-tab";
const SIDEBAR_TABS = ["shell", "plan", "state", "git"] as const;
type SidebarTab = (typeof SIDEBAR_TABS)[number];
const DEFAULT_TAB: SidebarTab = "state";

function isSidebarTab(value: string | null): value is SidebarTab {
  return SIDEBAR_TABS.includes(value as SidebarTab);
}

export function SessionRightSidebar() {
  const {
    sessionId,
    hasHydratedState,
    repoFullName,
    todos,
    plan: planMetadata,
    sessionStatus,
    pushedBranch,
    pullRequestState,
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
      renderShellSection={(isActivated) => (
        <SessionTerminal
          sessionId={sessionId}
          isSessionReady={sessionStatus === "ready"}
          isActivated={isActivated}
        />
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
      gitSection={(
        <SessionGitSection
          isLoading={!hasHydratedState}
          sessionId={sessionId}
          pushedBranch={pushedBranch}
          pullRequestState={pullRequestState}
        />
      )}
    />
  );
}

export function SessionRightSidebarLoading() {
  return (
    <SessionRightSidebarFrame
      headerDetail={<Skeleton className="mt-1 h-3 w-32" />}
      renderShellSection={() => (
        <SessionSidebarCard variant="empty" className="h-full py-6">
          Loading session...
        </SessionSidebarCard>
      )}
      todoSection={<SessionTodoListSection isLoading todos={null} />}
      planSection={(
        <SessionPlanSection
          isHydrated={false}
          plan={null}
          isLoading={false}
          errorMessage={null}
        />
      )}
      gitSection={(
        <SessionGitSection
          isLoading
          sessionId=""
          pushedBranch={null}
          pullRequestState={null}
        />
      )}
    />
  );
}

function SessionRightSidebarFrame({
  headerDetail,
  renderShellSection,
  todoSection,
  planSection,
  gitSection,
}: {
  headerDetail: ReactNode;
  renderShellSection: (isActivated: boolean) => ReactNode;
  todoSection: ReactNode;
  planSection: ReactNode;
  gitSection: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<SidebarTab>(DEFAULT_TAB);
  // True once the shell tab has been opened; the terminal connects lazily on
  // first activation and stays mounted (and connected) across tab switches.
  const [isShellActivated, setIsShellActivated] = useState(false);

  // Restore the persisted tab after mount to avoid SSR hydration mismatches.
  useEffect(() => {
    const storedTab = sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (isSidebarTab(storedTab)) {
      setActiveTab(storedTab);
      if (storedTab === "shell") {
        setIsShellActivated(true);
      }
    }
  }, []);

  const handleTabChange = (value: string) => {
    if (!isSidebarTab(value)) {
      return;
    }
    setActiveTab(value);
    sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, value);
    if (value === "shell") {
      setIsShellActivated(true);
    }
  };

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

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 px-2 pb-2">
          <TabsList className="w-full">
            <TabsTrigger value="shell" className="flex-1">Shell</TabsTrigger>
            <TabsTrigger value="plan" className="flex-1">Plan</TabsTrigger>
            <TabsTrigger value="state" className="flex-1">State</TabsTrigger>
            <TabsTrigger value="git" className="flex-1">Git</TabsTrigger>
          </TabsList>
        </div>

        {/* forceMount keeps the terminal (and its shell connection) alive across tab switches. */}
        <TabsContent
          value="shell"
          forceMount
          className="min-h-0 flex-1 px-2 pb-2 data-[state=inactive]:hidden"
        >
          {renderShellSection(isShellActivated)}
        </TabsContent>

        <TabsContent value="plan" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {planSection}
        </TabsContent>

        <TabsContent value="state" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {todoSection}
        </TabsContent>

        <TabsContent value="git" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {gitSection}
        </TabsContent>
      </Tabs>
    </AppRightSidebarPortal>
  );
}
