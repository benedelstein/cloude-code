"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Archive, Globe, LoaderCircle, Trash2 } from "lucide-react";
import { archiveSession, deleteSession, openEditor } from "@/lib/client-api";
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
  "h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-sm border transition-colors";

function VSCodeIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M30.865 3.448l-6.583-3.167c-0.766-0.37-1.677-0.214-2.276 0.385l-12.609 11.505-5.495-4.167c-0.51-0.391-1.229-0.359-1.703 0.073l-1.76 1.604c-0.583 0.526-0.583 1.443-0.005 1.969l4.766 4.349-4.766 4.349c-0.578 0.526-0.578 1.443 0.005 1.969l1.76 1.604c0.479 0.432 1.193 0.464 1.703 0.073l5.495-4.172 12.615 11.51c0.594 0.599 1.505 0.755 2.271 0.385l6.589-3.172c0.693-0.333 1.13-1.031 1.13-1.802v-21.495c0-0.766-0.443-1.469-1.135-1.802zM24.005 23.266l-9.573-7.266 9.573-7.266z" />
    </svg>
  );
}

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
          aria-label={loading ? "Opening editor" : "Open editor"}
          className={`${buttonBaseClassName} ${
            error
              ? "border-danger/30 text-danger hover:bg-danger/10"
              : editorLink
                ? "border-success/30 text-success hover:bg-success/10"
                : "border-border text-foreground-muted hover:bg-accent-subtle hover:text-foreground"
          } ${disabled || loading ? "opacity-50 pointer-events-none" : ""}`}
        >
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <VSCodeIcon />}
        </a>
      </TooltipTrigger>
      <TooltipContent>
        {error ?? "Open hosted VS Code to make manual edits"}
      </TooltipContent>
    </Tooltip>
  );
}

export function BrowserButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Open browser"
          className={`${buttonBaseClassName} border-border text-foreground-muted hover:bg-accent-subtle hover:text-foreground cursor-pointer`}
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
