"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Archive, Trash2, LogOut, ChevronsUpDown, MoreHorizontal, Edit } from "lucide-react";
import { deleteSession, archiveSession, type SessionSummary } from "@/lib/client-api";
import { useAuth } from "@/hooks/use-auth";
import { useSessionList } from "@/components/providers/session-list-provider";
import { formatRelativeTime } from "./utils";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SIDEBAR_HEADER_HEIGHT_CLASS,
  SidebarGroupLabel,
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

const SESSION_LIST_LOADING_ITEMS: SessionSummary[] = [
  {
    id: "loading-session-1",
    repoId: 0,
    repoFullName: "loading/repository",
    title: "Loading session",
    archived: false,
    createdAt: "",
    updatedAt: "",
    lastMessageAt: null,
  },
  {
    id: "loading-session-2",
    repoId: 0,
    repoFullName: "loading/repository",
    title: "Loading session",
    archived: false,
    createdAt: "",
    updatedAt: "",
    lastMessageAt: null,
  },
  {
    id: "loading-session-3",
    repoId: 0,
    repoFullName: "loading/repository",
    title: "Loading session",
    archived: false,
    createdAt: "",
    updatedAt: "",
    lastMessageAt: null,
  },
];

export function SessionSidebar() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const { setOpenMobile } = useSidebar();
  const activeSessionId = params?.sessionId as string | undefined;
  const { sessions, loading: sessionsLoading, removeSession } = useSessionList();

  const [terminatingSessionId, setTerminatingSessionId] = useState<string | null>(null);
  const [archivingSessionId, setArchivingSessionId] = useState<string | null>(null);
  const [deleteDialogSessionId, setDeleteDialogSessionId] = useState<string | null>(null);

  const navigate = (path: string) => {
    router.push(path);
    setOpenMobile(false);
  };

  const closeMobileSidebar = () => {
    setOpenMobile(false);
  };

  const handleArchiveSession = async (sessionId: string) => {
    setArchivingSessionId(sessionId);
    if (sessionId === activeSessionId) {
      navigate("/");
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
      navigate("/");
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

  function SessionSidebarRow({
    session,
    loading = false,
    isActive = false,
    isActionLoading = false,
  }: {
    session: SessionSummary;
    loading?: boolean;
    isActive?: boolean;
    isActionLoading?: boolean;
  }) {
    const repositoryName = session.repoFullName.split("/")[1] || session.repoFullName;
    const displayTitle = session.title || repositoryName || session.id.slice(0, 8);
    const timestamp = session.lastMessageAt || session.updatedAt;

    const rowContent = (
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        {loading ? (
          <>
            <Skeleton className="h-5 w-11/12" />
            <div className="flex h-4 items-center gap-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-12" />
            </div>
          </>
        ) : (
          <>
            <span className="truncate text-sm">
              {displayTitle}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-foreground-muted truncate">
                {repositoryName}
              </span>
              <span className="text-xs font-mono text-foreground-muted shrink-0">
                · {formatRelativeTime(timestamp)}
              </span>
            </div>
          </>
        )}
      </div>
    );

    return (
      <SidebarMenuItem>
        {loading ? (
          <SidebarMenuButton
            isActive={false}
            className="cursor-pointer h-auto min-h-[46px] py-2"
          >
            {rowContent}
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton
            asChild
            isActive={isActive}
            className="cursor-pointer h-auto min-h-[46px] py-2"
          >
            <Link href={`/session/${session.id}`} onClick={closeMobileSidebar}>
              {rowContent}
            </Link>
          </SidebarMenuButton>
        )}
        {loading ? (
          <></> // dont show
        ) : isActionLoading ? (
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
              <DropdownMenuItem onClick={() => handleArchiveSession(session.id)}>
                <Archive className="h-4 w-4" />
                Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteDialogSessionId(session.id)}
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
                  <Link href="/" onClick={closeMobileSidebar}>
                    <Edit className="h-4 w-4" />
                    <span>New session</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="pt-0">
            <SidebarGroupLabel>Sessions</SidebarGroupLabel>
            <SidebarGroupContent>
              {sessionsLoading ? (
                <SidebarMenu>
                  {SESSION_LIST_LOADING_ITEMS.map((session) => (
                    <SessionSidebarRow
                      key={session.id}
                      session={session}
                      loading
                    />
                  ))}
                </SidebarMenu>
              ) : sessions.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-foreground-muted">
                  No sessions yet
                </p>
              ) : (
                <SidebarMenu>
                  {sessions.map((session) => (
                    <SessionSidebarRow
                      key={session.id}
                      session={session}
                      isActive={session.id === activeSessionId}
                      isActionLoading={
                        terminatingSessionId === session.id
                        || archivingSessionId === session.id
                      }
                    />
                  ))}
                </SidebarMenu>
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
          if (!open) setDeleteDialogSessionId(null);
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
