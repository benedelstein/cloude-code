"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, FileText, Loader2 } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { AppRightSidebarPortal } from "@/components/layout/app-right-sidebar-context";
import { getSessionPlan } from "@/lib/client-api";
import {
  SidebarContent,
  SidebarHeader,
  SIDEBAR_HEADER_HEIGHT_CLASS,
  SidebarGroupContent,
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import type { SessionPlanResponse } from "@repo/shared";

export function SessionRightSidebar() {
  const {
    sessionId,
    repoFullName,
    todos,
    planAvailable,
    planUpdatedAt,
  } = useSession();
  const [plan, setPlan] = useState<SessionPlanResponse | null>(null);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    if (!planAvailable) {
      setPlan(null);
      setPlanError(null);
      setIsPlanLoading(false);
      return;
    }

    let isCancelled = false;
    setIsPlanLoading(true);
    setPlanError(null);

    void getSessionPlan(sessionId)
      .then((latestPlan) => {
        if (isCancelled) {
          return;
        }
        setPlan(latestPlan);
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        console.error("Failed to load session plan", error);
        setPlanError("Failed to load plan.");
      })
      .finally(() => {
        if (!isCancelled) {
          setIsPlanLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [planAvailable, planUpdatedAt, sessionId]);

  const completedTodos = todos?.filter((todo) => todo.status === "completed").length ?? 0;

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

      <SidebarContent className="gap-1 px-0">
        <SidebarGroup>
          <SidebarGroupLabel>Todo List</SidebarGroupLabel>
          <SidebarGroupContent>
            <section className="rounded-xl border border-sidebar-border bg-background/55 p-3">
              {todos && todos.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">Tasks</p>
                    <span className="text-xs text-foreground-muted">
                      {completedTodos}/{todos.length} completed
                    </span>
                  </div>
                  <div className="space-y-2">
                    {todos.map((todo, index) => (
                      <div key={`${todo.content}-${index}`} className="flex items-start gap-2 text-sm">
                        <TodoStatusIcon status={todo.status} />
                        <div className="min-w-0 pt-0.5">
                          <p className="break-words text-foreground">{todo.content}</p>
                          {todo.activeForm ? (
                            <p className="break-words text-xs text-foreground-muted">{todo.activeForm}</p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-foreground-muted">
                  No session todo data yet.
                </div>
              )}
            </section>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Plan</SidebarGroupLabel>
          <SidebarGroupContent>
            <section className="rounded-xl border border-sidebar-border bg-background/55 p-3">
              {isPlanLoading ? (
                <div className="flex items-center gap-2 text-sm text-foreground-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading plan...</span>
                </div>
              ) : planError ? (
                <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-foreground-muted">
                  {planError}
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
                    <pre className="whitespace-pre-wrap break-words text-xs text-foreground-muted">
                      {plan.plan}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-foreground-muted">
                  No plan captured yet.
                </div>
              )}
            </section>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </AppRightSidebarPortal>
  );
}

function TodoStatusIcon({
  status,
}: {
  status: "pending" | "in_progress" | "completed";
}) {
  if (status === "completed") {
    return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />;
  }

  if (status === "in_progress") {
    return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-600" />;
  }

  return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />;
}
