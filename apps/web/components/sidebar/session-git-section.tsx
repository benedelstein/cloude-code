"use client";

import { ExternalLink, Copy, Check } from "lucide-react";
import type { ClientState } from "@repo/shared";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { PrStatusIcon } from "@/components/chat/pr-status-icon";
import {
  SessionSidebarCard,
  SessionSidebarSection,
} from "@/components/sidebar/session-sidebar-section";
import { Skeleton } from "@/components/ui/skeleton";
import { usePullRequest } from "@/hooks/use-pull-request";

interface SessionGitSectionProps {
  isLoading: boolean;
  sessionId: string;
  pushedBranch: string | null;
  pullRequestState: ClientState["pullRequest"] | null;
}

export function SessionGitSection({
  isLoading,
  sessionId,
  pushedBranch,
  pullRequestState,
}: SessionGitSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <SessionSidebarSection title="Branch">
        {isLoading ? (
          <SessionSidebarCard>
            <Skeleton className="h-5 w-40" />
          </SessionSidebarCard>
        ) : pushedBranch ? (
          <SessionBranchCard
            sessionId={sessionId}
            pushedBranch={pushedBranch}
            pullRequestState={pullRequestState}
          />
        ) : (
          <SessionSidebarCard variant="empty" className="py-6">
            No branch pushed yet.
          </SessionSidebarCard>
        )}
      </SessionSidebarSection>

      <SessionSidebarSection title="Changes">
        <SessionSidebarCard variant="empty" className="py-6">
          Diff view coming soon.
        </SessionSidebarCard>
      </SessionSidebarSection>
    </div>
  );
}

function SessionBranchCard({
  sessionId,
  pushedBranch,
  pullRequestState,
}: {
  sessionId: string;
  pushedBranch: string;
  pullRequestState: ClientState["pullRequest"] | null;
}) {
  const {
    url,
    state,
    failedPullRequest,
    showCreating,
    displayError,
    copied,
    copyBranchName,
    handleCreatePullRequest,
  } = usePullRequest({ sessionId, pushedBranch, pullRequestState });
  const isCreatingPullRequest = pullRequestState?.status === "creating";

  return (
    <SessionSidebarCard className="gap-2.5">
      <div className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
        {isCreatingPullRequest ? (
          <LoadingSpinner className="h-4 w-4 shrink-0 text-foreground-tertiary" />
        ) : (
          <PrStatusIcon pullRequestUrl={url} pullRequestState={state} />
        )}
        <button
          type="button"
          onClick={() => void copyBranchName()}
          className="inline-flex min-w-0 items-center gap-1.5 text-foreground text-xs font-medium truncate rounded px-1 -mx-1 hover:bg-foreground/10 transition-colors cursor-pointer"
          title={copied ? "Copied!" : "Click to copy branch name"}
        >
          <span className="truncate">{pushedBranch}</span>
          {copied ? (
            <Check className="h-3 w-3 shrink-0 text-accent" />
          ) : (
            <Copy className="h-3 w-3 shrink-0 text-foreground-secondary" />
          )}
        </button>
      </div>

      {displayError ? (
        <p className="text-xs text-danger" title={displayError}>{displayError}</p>
      ) : null}

      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 rounded-md bg-accent-subtle px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
        >
          View PR
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <button
          onClick={() => void handleCreatePullRequest()}
          disabled={showCreating}
          className="inline-flex w-fit items-center cursor-pointer gap-1.5 rounded-md bg-accent-subtle px-3 py-1 text-xs font-bold text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {showCreating ? (
            <>
              <LoadingSpinner className="h-3 w-3" />
              Creating...
            </>
          ) : failedPullRequest ? (
            "Retry PR"
          ) : (
            "Create PR"
          )}
        </button>
      )}
    </SessionSidebarCard>
  );
}
