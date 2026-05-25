"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Archive,
  Trash2,
  LogOut,
  ChevronsUpDown,
  MoreHorizontal,
  Edit,
  FolderGit2,
  Plus,
} from "lucide-react";
import {
  deleteSession,
  archiveSession,
  type SessionRepoGroup,
  type SessionSummary,
} from "@/lib/client-api";
import { useAuth } from "@/hooks/use-auth";
import { useSessionList } from "@/components/providers/session-list-provider";
import { useNow } from "@/lib/use-now";
import { PrStatusIcon } from "@/components/chat/pr-status-icon";
import { formatCompactRelativeTime } from "./utils";
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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  "w-full text-left px-2 py-1.5 text-xs text-foreground-muted hover:text-foreground hover:bg-sidebar-accent rounded-md cursor-pointer transition-colors disabled:cursor-default disabled:opacity-60";

function repoDisplayName(repoFullName: string): string {
  return repoFullName.split("/")[1] || repoFullName;
}

interface SessionRowProps {
  session: SessionSummary;
  isActive: boolean;
  isActionLoading: boolean;
  nowMs: number;
  onCloseMobileSidebar: () => void;
  onArchive: (sessionId: string) => void;
  onRequestDelete: (sessionId: string) => void;
}

function SessionStatusSlot({ session }: { session: SessionSummary }) {
  if (session.workingState === "responding") {
    return (
      <span role="status" aria-label="Responding">
        <LoadingSpinner className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
      </span>
    );
  }

  if (session.pullRequest || session.pushedBranch) {
    return (
      <PrStatusIcon
        pullRequestUrl={session.pullRequest?.url ?? null}
        pullRequestState={session.pullRequest?.state ?? null}
      />
    );
  }

  return <span aria-hidden="true" className="block h-5 w-5" />;
}

function SessionRow({
  session,
  isActive,
  isActionLoading,
  nowMs,
  onCloseMobileSidebar,
  onArchive,
  onRequestDelete,
}: SessionRowProps) {
  const displayTitle =
    session.title || repoDisplayName(session.repoFullName) || session.id.slice(0, 8);
  const timestamp = session.lastMessageAt || session.updatedAt;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className="cursor-pointer h-auto min-h-8 py-1"
      >
        <Link href={`/session/${session.id}`} onClick={onCloseMobileSidebar}>
          <div className="grid min-w-0 flex-1 grid-cols-[1.25rem_minmax(0,1fr)_2.25rem] items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center">
              <SessionStatusSlot session={session} />
            </span>
            <span className="truncate text-sm">{displayTitle}</span>
            <span className="justify-self-end text-xs font-mono text-foreground-muted transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0">
              {formatCompactRelativeTime(timestamp, nowMs)}
            </span>
          </div>
        </Link>
      </SidebarMenuButton>
      {isActionLoading ? (
        <SidebarMenuAction className="top-1/2! -translate-y-1/2 aspect-auto! w-auto! px-1.5 py-1">
          <LoadingSpinner className="h-3 w-3 shrink-0" />
        </SidebarMenuAction>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              className="top-1/2! -translate-y-1/2 aspect-auto! w-auto! px-1.5 py-1 rounded-md bg-sidebar-border! hover:bg-[#c9d1db]!"
            >
              <MoreHorizontal className="h-3 w-3" />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onClick={() => onArchive(session.id)}>
              <Archive className="h-4 w-4" />
              Archive
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onRequestDelete(session.id)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );
}

interface RepoGroupBlockProps {
  group: SessionRepoGroup;
  activeSessionId: string | undefined;
  isCollapsed: boolean;
  terminatingSessionId: string | null;
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
  terminatingSessionId,
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
      <div className="group/repo flex h-8 w-full items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground-muted transition-colors hover:bg-sidebar-accent hover:text-foreground">
        <button
          type="button"
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
          aria-expanded={!isCollapsed}
          onClick={() => onToggleCollapsed(group.repoId)}
        >
          <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{repoName}</span>
        </button>
        <button
          type="button"
          aria-label={`New session in ${repoName}`}
          className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-foreground-muted hover:bg-sidebar-border hover:text-foreground"
          onClick={() => onNewSessionForRepo(group.repoId, group.repoFullName)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {!isCollapsed && (
        <>
          <SidebarMenu>
            {group.sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                isActionLoading={
                  terminatingSessionId === session.id
                  || archivingSessionId === session.id
                }
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
        </>
      )}
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

export function SessionSidebar() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
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

  const [terminatingSessionId, setTerminatingSessionId] = useState<string | null>(null);
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
    setTerminatingSessionId(sessionId);
    setDeleteDialogSessionId(null);
    if (sessionId === activeSessionId) {
      navigate("/dashboard");
    }
    try {
      await deleteSession(sessionId);
      removeSession(sessionId);
    } catch (err) {
      console.error("Failed to delete session:", err);
    } finally {
      setTerminatingSessionId(null);
    }
  };

  return (
    <>
      <Sidebar collapsible="offcanvas" variant="floating">
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
                    <Edit className="h-4 w-4" />
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
                <p className="px-2 py-6 text-center text-xs text-foreground-muted">
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
                      terminatingSessionId={terminatingSessionId}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="cursor-pointer">
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
                    <ChevronsUpDown className="ml-auto h-4 w-4 text-foreground-muted" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-48">
                  {/* add a github logo next to user login */}
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <Image
                      src="/github_logo.svg"
                      alt="GitHub logo"
                      width={16}
                      height={16}
                    />
                    <span className="text-sm">{user?.login}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
