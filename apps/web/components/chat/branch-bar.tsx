"use client";

import { ExternalLink, Copy, Check } from "lucide-react";
import type { ClientState } from "@repo/shared";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { PrStatusIcon } from "@/components/chat/pr-status-icon";
import { usePullRequest } from "@/hooks/use-pull-request";

interface BranchBarProps {
  sessionId: string;
  pushedBranch: string | null;
  pullRequestState: ClientState["pullRequest"] | null;
}

export function BranchBar({
  sessionId,
  pushedBranch,
  pullRequestState,
}: BranchBarProps) {
  const {
    url,
    state,
    failedPullRequest,
    showCreating,
    displayError,
    copied,
    copyBranchName,
    handleCreatePullRequest: handleCreatePR,
  } = usePullRequest({ sessionId, pushedBranch, pullRequestState });
  const isCreatingPullRequest = pullRequestState?.status === "creating";

  if (!pushedBranch) { return null; }

  return (
    <div className="min-w-0 shrink-0 overflow-hidden rounded-lg border border-border bg-background mb-2 shadow-shadow shadow-xl">
      <div className="px-4 py-2 flex min-w-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-foreground-secondary min-w-0">
          {isCreatingPullRequest ? (
            <LoadingSpinner className="h-4 w-4 shrink-0 text-foreground-tertiary" />
          ) : (
            <PrStatusIcon pullRequestUrl={url} pullRequestState={state} />
          )}
          <button
            type="button"
            onClick={() => void copyBranchName()}
            className="inline-flex min-w-0 items-center gap-1.5 text-foreground font-medium truncate rounded px-1 -mx-1 hover:bg-foreground/10 transition-colors cursor-pointer"
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

        <div className="flex items-center gap-2 shrink-0">
          {displayError && (
            <span className="max-w-md truncate text-xs text-danger" title={displayError}>{displayError}</span>
          )}

          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-accent-subtle px-3 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
            >
              View PR
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <button
              onClick={handleCreatePR}
              disabled={showCreating}
              className="inline-flex items-center cursor-pointer gap-1.5 rounded-md bg-accent-subtle px-3 py-1 text-xs font-bold text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
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
        </div>
      </div>
    </div>
  );
}
