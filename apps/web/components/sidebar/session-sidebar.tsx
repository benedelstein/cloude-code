"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Plus, Archive, Trash2, LogOut, ChevronsUpDown } from "lucide-react";
import { deleteSession, archiveSession } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useSessionList } from "@/components/providers/session-list-provider";
import { formatRelativeTime } from "./utils";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupAction,
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

export function SessionSidebar() {
  const { user, logout } = useAuth();
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

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => navigate("/")}
              className="cursor-pointer"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground font-bold text-sm">
                c
              </div>
              <span className="font-semibold text-sm">cloude</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Sessions</SidebarGroupLabel>
          <SidebarGroupAction title="New session" onClick={() => navigate("/")}>
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            {sessionsLoading ? (
              <div className="flex justify-center py-6">
                <LoadingSpinner className="h-4 w-4 text-foreground-muted" />
              </div>
            ) : sessions.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-foreground-muted">
                No sessions yet
              </p>
            ) : (
              <SidebarMenu>
                {sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const displayTitle = session.title || session.repoFullName.split("/")[1] || session.id.slice(0, 8);
                  const timestamp = session.lastMessageAt || session.updatedAt;
                  const isLoading = terminatingSessionId === session.id || archivingSessionId === session.id;

                  return (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => navigate(`/session/${session.id}`)}
                        className="cursor-pointer h-auto py-2"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm">{displayTitle}</span>
                            {isLoading ? (
                              <LoadingSpinner className="h-3 w-3 shrink-0" />
                            ) : (
                              <span className="text-[10px] text-foreground-muted shrink-0">
                                {formatRelativeTime(timestamp)}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-foreground-muted truncate">
                            {session.repoFullName}
                          </span>
                        </div>
                      </SidebarMenuButton>
                      {!isLoading && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction showOnHover>
                              <ChevronsUpDown className="h-3 w-3" />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start">
                            <DropdownMenuItem
                              onClick={() => handleArchiveSession(session.id)}
                            >
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
                })}
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
                <SidebarMenuButton className="cursor-pointer">
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.login}
                      className="h-5 w-5 rounded-full"
                    />
                  ) : (
                    <div className="h-5 w-5 rounded-full bg-sidebar-accent" />
                  )}
                  <span className="truncate text-sm">{user?.login ?? "User"}</span>
                  <ChevronsUpDown className="ml-auto h-4 w-4 text-foreground-muted" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-48">
                <DropdownMenuLabel>{user?.login}</DropdownMenuLabel>
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

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteDialogSessionId !== null}
        onOpenChange={(open) => { if (!open) setDeleteDialogSessionId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this session and all associated data. This action cannot be undone.
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
    </Sidebar>
  );
}
