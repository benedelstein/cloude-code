"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Globe, Trash2 } from "lucide-react";
import { archiveSession, deleteSession } from "@/lib/client-api";
import { useSessionList } from "@/components/providers/session-list-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

interface SessionActionsButtonProps {
  sessionId: string;
}

const buttonBaseClassName =
  "h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-sm border transition-colors";

export function BrowserButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Open browser"
          className={`${buttonBaseClassName} border-border text-foreground-secondary hover:bg-accent-subtle hover:text-foreground cursor-pointer`}
        >
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Open hosted browser on remote server
      </TooltipContent>
    </Tooltip>
  );
}

export function SessionActionsButton({ sessionId }: SessionActionsButtonProps) {
  const router = useRouter();
  const { removeSession } = useSessionList();

  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isBusy = isArchiving || isDeleting;

  async function handleArchiveSession(): Promise<void> {
    setIsArchiving(true);
    router.push("/dashboard");
    try {
      await archiveSession(sessionId);
      removeSession(sessionId);
    } catch (error) {
      console.error("Failed to archive session:", error);
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleDeleteSession(): Promise<void> {
    setIsDeleting(true);
    setDeleteDialogOpen(false);
    router.push("/dashboard");
    try {
      await deleteSession(sessionId);
      removeSession(sessionId);
    } catch (error) {
      console.error("Failed to delete session:", error);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={isBusy}
            className={`h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-sm text-foreground-secondary hover:bg-muted hover:text-foreground transition-colors ${isBusy ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
            aria-label="Session actions"
          >
            <span className="flex items-center justify-center gap-[3px]" aria-hidden="true">
              <span className="h-[3px] w-[3px] rounded-full bg-current" />
              <span className="h-[3px] w-[3px] rounded-full bg-current" />
              <span className="h-[3px] w-[3px] rounded-full bg-current" />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem onClick={() => void handleArchiveSession()}>
            <Archive className="h-4 w-4" />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent container={typeof document !== "undefined" ? document.body : undefined}>
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
              onClick={() => void handleDeleteSession()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
