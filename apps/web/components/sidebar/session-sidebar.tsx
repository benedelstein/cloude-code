"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter, useParams } from "next/navigation";
import {
  ArrowUpRight,
  ChevronRight,
  CirclePlus,
  FolderGit2,
  Plus,
  Settings,
} from "lucide-react";
import {
  deleteSession,
  archiveSession,
  type SessionRepoGroup,
} from "@/lib/client-api";
import { useAuth } from "@/hooks/use-auth";
import { useSessionList } from "@/components/providers/session-list-provider";
import { useNow } from "@/lib/use-now";
import { repoDisplayName } from "./utils";
import { SessionRow } from "./session-row";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SIDEBAR_HEADER_HEIGHT_CLASS,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Link from "next/link";

const SESSION_LOADING_SKELETON_COUNT = 3;
const SHOW_MORE_BUTTON_CLASSES =
  "w-full text-left px-2 py-1.5 text-xs text-foreground-secondary hover:text-foreground hover:bg-sidebar-accent rounded-md cursor-pointer transition-colors disabled:cursor-default disabled:opacity-60";
const REPO_HEADER_ACTION_CLASSES =
  "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-foreground-secondary opacity-0 transition-none hover:bg-control-background hover:text-foreground focus-visible:opacity-100 group-hover/repo:opacity-100 group-focus-within/repo:opacity-100";

interface RepoGroupBlockProps {
  group: SessionRepoGroup;
  activeSessionId: string | undefined;
  isCollapsed: boolean;
  archivingSessionId: string | null;
  loadingMoreSessions: boolean;
  nowMs: number;
  onCloseMobileSidebar: () => void;
  onArchive: (sessionId: string) => void;
  onRequestDelete: (sessionId: string) => void;
  onToggleCollapsed: (repoId: number) => void;
  onLoadMoreSessions: (repoId: number) => void;
  onNewSessionForRepo: (repoId: number, repoFullName: string) => void;
}

function RepoGroupBlock({
  group,
  activeSessionId,
  isCollapsed,
  archivingSessionId,
  loadingMoreSessions,
  nowMs,
  onCloseMobileSidebar,
  onArchive,
  onRequestDelete,
  onToggleCollapsed,
  onLoadMoreSessions,
  onNewSessionForRepo,
}: RepoGroupBlockProps) {
  const repoName = repoDisplayName(group.repoFullName);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="group/repo grid h-8 w-full grid-cols-[1.25rem_minmax(0,1fr)_3rem] items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-foreground-secondary transition-colors hover:text-foreground">
        <button
          type="button"
          className="col-start-1 col-end-3 grid h-full min-w-0 cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1.5 text-left"
          aria-expanded={!isCollapsed}
          onClick={() => onToggleCollapsed(group.repoId)}
        >
          <span className="flex h-5 w-5 items-center justify-center">
            <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate">{repoName}</span>
            <ChevronRight
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            />
          </span>
        </button>
        <div className="col-start-3 flex items-center justify-end gap-1.5">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <a
                href={`https://github.com/${group.repoFullName}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${repoName} on GitHub`}
                className={REPO_HEADER_ACTION_CLASSES}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent>Open {repoName} on GitHub</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`New session in ${repoName}`}
                className={REPO_HEADER_ACTION_CLASSES}
                onClick={() => onNewSessionForRepo(group.repoId, group.repoFullName)}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>New session in {repoName}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <SidebarMenu>
            {group.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                isActionLoading={archivingSessionId === session.id}
                nowMs={nowMs}
                onCloseMobileSidebar={onCloseMobileSidebar}
                onArchive={onArchive}
                onRequestDelete={onRequestDelete}
              />
            ))}
          </SidebarMenu>
          {group.nextSessionCursor !== null && (
            <button
              type="button"
              className={SHOW_MORE_BUTTON_CLASSES}
              onClick={() => onLoadMoreSessions(group.repoId)}
              disabled={loadingMoreSessions}
            >
              {loadingMoreSessions ? (
                <span className="flex items-center gap-1.5">
                  <LoadingSpinner className="h-3 w-3" />
                  Loading…
                </span>
              ) : (
                "Show more"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionListSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pt-2 pb-1">
        <Skeleton className="h-3 w-20" />
      </div>
      <SidebarMenu>
        {Array.from({ length: SESSION_LOADING_SKELETON_COUNT }).map((_, i) => (
          <SidebarMenuItem key={i}>
            <SidebarMenuButton
              isActive={false}
              className="cursor-default h-auto min-h-8 py-1"
            >
              <div className="grid min-w-0 flex-1 grid-cols-[1.25rem_minmax(0,1fr)_2.25rem] items-center gap-1.5">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 min-w-0" />
                <Skeleton className="h-3 w-7 justify-self-end" />
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </div>
  );
}

interface SessionSidebarProps {
  className?: string;
  resizeHandle?: ReactNode;
}

export function SessionSidebar({ className, resizeHandle }: SessionSidebarProps) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const { setOpenMobile } = useSidebar();
  const activeSessionId = params?.sessionId as string | undefined;
  const nowMs = useNow(15_000);
  const {
    groups,
    loading: sessionsLoading,
    nextRepoCursor,
    loadingMoreRepos,
    loadingMoreSessionsByRepo,
    removeSession,
    loadMoreRepos,
    loadMoreSessionsForRepo,
  } = useSessionList();

  const [archivingSessionId, setArchivingSessionId] = useState<string | null>(null);
  const [deleteDialogSessionId, setDeleteDialogSessionId] = useState<string | null>(null);
  const [collapsedRepoIds, setCollapsedRepoIds] = useState<Set<number>>(() => new Set());

  const navigate = (path: string) => {
    router.push(path);
    setOpenMobile(false);
  };

  const closeMobileSidebar = () => {
    setOpenMobile(false);
  };

  const toggleRepoCollapsed = (repoId: number) => {
    setCollapsedRepoIds((current) => {
      const next = new Set(current);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else {
        next.add(repoId);
      }
      return next;
    });
  };

  const newSessionForRepo = (repoId: number, repoFullName: string) => {
    const params = new URLSearchParams({
      repoId: String(repoId),
      repoFullName,
    });
    navigate(`/dashboard?${params.toString()}`);
  };

  const handleArchiveSession = async (sessionId: string) => {
    setArchivingSessionId(sessionId);
    if (sessionId === activeSessionId) {
      navigate("/dashboard");
    }
    try {
      await archiveSession(sessionId);
      removeSession(sessionId);
    } catch (err) {
      console.error("Failed to archive session:", err);
    } finally {
      setArchivingSessionId(null);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setDeleteDialogSessionId(null);
    if (sessionId === activeSessionId) {
      navigate("/dashboard");
    }
    removeSession(sessionId);
    try {
      await deleteSession(sessionId);
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  return (
    <>
      <Sidebar collapsible="offcanvas" variant="floating" className={className}>
        {resizeHandle}
        <SidebarHeader className={`${SIDEBAR_HEADER_HEIGHT_CLASS} justify-right border-b border-sidebar-border p-0`}>
          <div className="flex flex-row items-center justify-end h-full">
            {/* <div className="flex h-8 w-8 text-2xl">☁️</div> */}
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="pb-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className="cursor-pointer font-medium py-5"
                  tooltip="New session"
                >
                  <Link href="/dashboard" onClick={closeMobileSidebar}>
                    <CirclePlus className="h-4 w-4" />
                    <span>New session</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="pt-0">
            <SidebarGroupContent>
              {sessionsLoading ? (
                <SessionListSkeleton />
              ) : groups.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-foreground-secondary">
                  No sessions yet
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {groups.map((group) => (
                    <RepoGroupBlock
                      key={group.repoId}
                      group={group}
                      activeSessionId={activeSessionId}
                      isCollapsed={collapsedRepoIds.has(group.repoId)}
                      archivingSessionId={archivingSessionId}
                      loadingMoreSessions={
                        loadingMoreSessionsByRepo[group.repoId] === true
                      }
                      nowMs={nowMs}
                      onCloseMobileSidebar={closeMobileSidebar}
                      onArchive={handleArchiveSession}
                      onRequestDelete={setDeleteDialogSessionId}
                      onToggleCollapsed={toggleRepoCollapsed}
                      onLoadMoreSessions={loadMoreSessionsForRepo}
                      onNewSessionForRepo={newSessionForRepo}
                    />
                  ))}
                  {nextRepoCursor !== null && (
                    <button
                      type="button"
                      className={SHOW_MORE_BUTTON_CLASSES}
                      onClick={() => void loadMoreRepos()}
                      disabled={loadingMoreRepos}
                    >
                      {loadingMoreRepos ? (
                        <span className="flex items-center gap-1.5">
                          <LoadingSpinner className="h-3 w-3" />
                          Loading…
                        </span>
                      ) : (
                        "Show more repos"
                      )}
                    </button>
                  )}
                </div>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="lg"
                isActive={pathname === "/settings"}
                className="cursor-pointer"
              >
                <Link href="/settings" onClick={closeMobileSidebar}>
                  {authLoading ? (
                    <>
                      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                      <Skeleton className="h-4 w-24" />
                    </>
                  ) : user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.login}
                      className="h-8 w-8 shrink-0 rounded-full"
                    />
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded-full bg-sidebar-accent" />
                  )}
                  {!authLoading ? (
                    <span className="truncate text-sm">
                      {user?.login ?? "User"}
                    </span>
                  ) : null}
                  <Settings className="ml-auto h-4 w-4 text-foreground-muted" />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <AlertDialog
        open={deleteDialogSessionId !== null}
        onOpenChange={(open) => {
          if (!open) { setDeleteDialogSessionId(null); }
        }}
      >
        <AlertDialogContent
          container={
            typeof document !== "undefined" ? document.body : undefined
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this session and all associated data.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteDialogSessionId) {
                  void handleDeleteSession(deleteDialogSessionId);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
