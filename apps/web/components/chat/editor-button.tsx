"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Archive, Code, Trash2 } from "lucide-react";
import { archiveSession, deleteSession, openEditor } from "@/lib/api";
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

interface EditorButtonProps {
  sessionId: string;
  editorUrl: string | null;
  disabled: boolean;
}

interface SessionActionsButtonProps {
  sessionId: string;
}

const buttonBaseClassName =
  "h-7 flex items-center gap-1.5 px-2 py-1 text-xs rounded-sm border transition-colors";

export function EditorButton({ sessionId, editorUrl, disabled }: EditorButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorLink, setEditorLink] = useState<string | null>(null);

  // When editorUrl is set (e.g. from state on page load), eagerly fetch the token
  useEffect(() => {
    if (editorUrl && !editorLink) {
      openEditor(sessionId)
        .then((result) => setEditorLink(`${result.url}?tkn=${result.token}`))
        .catch(() => {/* will fetch on click instead */});
    }
  }, [editorUrl, editorLink, sessionId]);

  async function handleClick(event: React.MouseEvent) {
    // If we already have the link, let the <a> handle it natively
    if (editorLink) return;

    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await openEditor(sessionId);
      const fullUrl = `${result.url}?tkn=${result.token}`;
      setEditorLink(fullUrl);
      // Navigate now - opens in new tab via the link's target="_blank"
      window.open(fullUrl, "_blank");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open editor";
      setError(message);
      console.error("Failed to open editor:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={editorLink ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          className={`${buttonBaseClassName} ${
            error
              ? "border-danger/30 text-danger hover:bg-danger/10"
              : editorLink
                ? "border-success/30 text-success hover:bg-success/10"
                : "border-border text-foreground-muted hover:bg-accent-subtle hover:text-foreground"
          } ${disabled || loading ? "opacity-50 pointer-events-none" : ""}`}
        >
          <Code className="h-3.5 w-3.5" />
          {loading ? "Opening..." : "Open Editor"}
        </a>
      </TooltipTrigger>
      <TooltipContent>
        {error ?? "Open hosted VS Code to make manual edits"}
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
    router.push("/");
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
    router.push("/");
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
            className={`h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-sm border border-border text-foreground-muted hover:bg-accent-subtle hover:text-foreground transition-colors ${isBusy ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
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
