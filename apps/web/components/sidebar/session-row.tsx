import Link from "next/link";
import { Archive, MoreHorizontal, Trash2 } from "lucide-react";
import type { SessionSummary } from "@/lib/client-api";
import { PrStatusIcon } from "@/components/chat/pr-status-icon";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCompactRelativeTime, repoDisplayName } from "./utils";

interface SessionRowProps {
  session: SessionSummary;
  isActive: boolean;
  isActionLoading: boolean;
  nowMs: number;
  onCloseMobileSidebar: () => void;
  onArchive: (sessionId: string) => void;
  onRequestDelete: (sessionId: string) => void;
}

function SessionArtifactSlot({ session }: { session: SessionSummary }) {
  if (session.pullRequest || session.pushedBranch) {
    return (
      <PrStatusIcon
        pullRequestUrl={session.pullRequest?.url ?? null}
        pullRequestState={session.pullRequest?.state ?? null}
        variant="plain"
      />
    );
  }

  return <span aria-hidden="true" className="block h-5 w-5" />;
}

function SessionAttentionSlot({
  session,
  isActive,
  nowMs,
  timestamp,
}: {
  session: SessionSummary;
  isActive: boolean;
  nowMs: number;
  timestamp: string;
}) {
  if (session.workingState === "responding") {
    return (
      <span role="status" aria-label="Responding">
        <LoadingSpinner className="h-3.5 w-3.5 shrink-0 text-foreground-secondary" />
      </span>
    );
  }

  if (session.hasUnread && !isActive) {
    return (
      <span
        role="status"
        aria-label="Unread message"
        className="block h-2 w-2 rounded-full bg-accent"
      />
    );
  }

  return (
    <span className="text-xs font-mono text-foreground-tertiary">
      {formatCompactRelativeTime(timestamp, nowMs)}
    </span>
  );
}

export function SessionRow({
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
        className="cursor-pointer h-auto min-h-8 px-1.5 py-1 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-focus-within/menu-item:bg-sidebar-accent group-focus-within/menu-item:text-sidebar-accent-foreground"
      >
        <Link
          href={`/session/${session.id}`}
          onClick={(event) => {
            if (isActive) {
              event.preventDefault();
              return;
            }

            onCloseMobileSidebar();
          }}
        >
          <div className="grid min-w-0 flex-1 grid-cols-[1.25rem_minmax(0,1fr)_2.25rem] items-center gap-1.5">
            <span className="col-start-1 row-start-1 flex h-5 w-5 items-center justify-center">
              <SessionArtifactSlot session={session} />
            </span>
            <span className="col-start-2 col-end-3 row-start-1 truncate text-sm group-hover/menu-item:col-end-4 group-hover/menu-item:pr-9 group-focus-within/menu-item:col-end-4 group-focus-within/menu-item:pr-9">
              {displayTitle}
            </span>
            <span className="col-start-3 row-start-1 flex h-5 w-[2.25rem] items-center justify-end justify-self-end group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0">
              <SessionAttentionSlot
                session={session}
                isActive={isActive}
                nowMs={nowMs}
                timestamp={timestamp}
              />
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
              className="top-1/2! -translate-y-1/2 aspect-auto! w-auto! px-1 py-[3px] rounded-sm bg-transparent! hover:bg-control-background! focus-visible:bg-control-background! data-[state=open]:bg-control-background!"
            >
              <MoreHorizontal className="h-2.5 w-2.5" />
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
