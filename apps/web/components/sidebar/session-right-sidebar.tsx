"use client";

import Link from "next/link";
// import { GitBranch, GitPullRequest, Split } from "lucide-react";
import { useSession } from "@/components/providers/session-provider";
import { AppRightSidebarPortal } from "@/components/layout/app-right-sidebar-context";
import {
  SidebarContent,
  // SidebarGroup,
  // SidebarGroupContent,
  // SidebarGroupLabel,
  SidebarHeader,
  SIDEBAR_HEADER_HEIGHT_CLASS,
  SidebarGroupContent,
  SidebarGroup,
} from "@/components/ui/sidebar";

export function SessionRightSidebar() {
  const {
    // pushedBranch,
    // pullRequestUrl,
    // pullRequestState,
    repoFullName,
  } = useSession();

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
          <SidebarGroupContent>
            <p className="text-sm text-foreground-muted max-w-full text-center my-4">Coming soon.</p>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* <SidebarGroup>
          <SidebarGroupLabel>Todo List</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarSection
              badge="Stub"
              emptyState="No session todo data yet. This will eventually come from server-owned parsed message state."
            />
          </SidebarGroupContent>
        </SidebarGroup> */}

        {/* <SidebarGroup>
          <SidebarGroupLabel>Workspace State</SidebarGroupLabel>
          <SidebarGroupContent>
            <section className="rounded-xl border border-sidebar-border bg-background/55 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="rounded-md bg-foreground/10 p-1.5 text-foreground-muted">
                    <Split className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Prototype summary</p>
                    <p className="text-xs text-foreground-muted">Session-level placeholders</p>
                  </div>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
                  Stub
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="rounded-lg border border-border bg-background p-2.5">
                  <div className="mb-0.5 flex items-center gap-2 text-foreground">
                    <GitBranch className="h-4 w-4 text-foreground-muted" />
                    <span className="font-medium">Branch</span>
                  </div>
                  <p className="break-all text-foreground-muted">
                    {pushedBranch ?? "No pushed branch yet."}
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-background p-2.5">
                  <div className="mb-0.5 flex items-center gap-2 text-foreground">
                    <GitPullRequest className="h-4 w-4 text-foreground-muted" />
                    <span className="font-medium">Pull Request</span>
                  </div>
                  {pullRequestUrl ? (
                    <div className="space-y-1">
                      <p className="text-foreground-muted">
                        Status: <span className="font-medium capitalize text-foreground">{pullRequestState ?? "open"}</span>
                      </p>
                      <Link
                        href={pullRequestUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block break-all text-accent hover:underline"
                      >
                        {pullRequestUrl}
                      </Link>
                    </div>
                  ) : (
                    <p className="text-foreground-muted">No pull request created yet.</p>
                  )}
                </div>

                <div className="rounded-lg border border-dashed border-border bg-background p-2.5">
                  <p className="font-medium text-foreground">Diff Summary</p>
                  <p className="mt-0.5 text-foreground-muted">
                    Git diff state is not wired yet. This section is reserved for server-provided file change status.
                  </p>
                </div>
              </div>
            </section>
          </SidebarGroupContent>
        </SidebarGroup> */}

        {/* <SidebarGroup>
          <SidebarGroupLabel>Plan</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarSection
              badge="Stub"
              emptyState="No plan captured yet. This will eventually show a persisted session plan summary."
            />
          </SidebarGroupContent>
        </SidebarGroup> */}
      </SidebarContent>
    </AppRightSidebarPortal>
  );
}

// interface SidebarSectionProps {
//   badge: string;
//   emptyState: string;
// }

// function SidebarSection({
//   badge,
//   emptyState,
// }: SidebarSectionProps) {
//   return (
//     <section className="rounded-xl border border-sidebar-border bg-background/55 p-3">
//       <div className="mb-2 flex items-center justify-end gap-3">
//         <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
//           {badge}
//         </span>
//       </div>
//       <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-foreground-muted">
//         {emptyState}
//       </div>
//     </section>
//   );
// }
