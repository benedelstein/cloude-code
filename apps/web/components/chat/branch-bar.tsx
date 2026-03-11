"use client";

import { useState, useEffect, useCallback } from "react";
import { GitPullRequest, GitMerge, GitPullRequestClosed, GitBranch, ExternalLink, Copy, Check } from "lucide-react";
import { createPullRequest, getPullRequestStatus } from "@/lib/api";
import type { PullRequestState } from "@repo/shared";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const POLL_INTERVAL_MS = 30_000;

interface BranchBarProps {
  sessionId: string;
  pushedBranch: string | null;
  pullRequestUrl: string | null;
  pullRequestState: PullRequestState | null;
}

export function BranchBar({
  sessionId,
  pushedBranch,
  pullRequestUrl,
  pullRequestState,
}: BranchBarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyBranchName = useCallback(async () => {
    if (!pushedBranch) return;
    await navigator.clipboard.writeText(pushedBranch);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pushedBranch]);

  // Poll PR status when PR exists and is open
  useEffect(() => {
    if (!pullRequestUrl || pullRequestState !== "open") return;

    const pollStatus = async () => {
      try {
        await getPullRequestStatus(sessionId);
        // State update comes via onStateUpdate from the DO
      } catch {
        // Silently ignore polling errors
      }
    };

    // Check immediately on mount/reconnect, then poll on interval
    void pollStatus();
    const interval = setInterval(pollStatus, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionId, pullRequestUrl, pullRequestState]);

  const handleCreatePR = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    try {
      const result = await createPullRequest(sessionId);
      // Open the PR in a new tab
      window.open(result.url, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PR");
    } finally {
      setIsCreating(false);
    }
  }, [sessionId]);

  if (!pushedBranch) return null;

  return (
    <div className="shrink-0 rounded-lg border border-border bg-background mb-2 shadow-shadow shadow-xl">
      <div className="px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-foreground-muted min-w-0">
          <PrStatusIcon pullRequestUrl={pullRequestUrl} pullRequestState={pullRequestState} />
          <span className="text-foreground font-medium">main</span>
          {" \u2190 "}
          <button
            type="button"
            onClick={() => void copyBranchName()}
            className="inline-flex items-center gap-1.5 text-foreground font-medium truncate rounded px-1 -mx-1 hover:bg-foreground/10 transition-colors cursor-pointer"
            title={copied ? "Copied!" : "Click to copy branch name"}
          >
            {pushedBranch}
            {copied ? (
              <Check className="h-3 w-3 shrink-0 text-accent" />
            ) : (
              <Copy className="h-3 w-3 shrink-0 text-foreground-muted" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {error && (
            <span className="text-xs text-danger">{error}</span>
          )}

          {pullRequestUrl ? (
            <a
              href={pullRequestUrl}
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
              disabled={isCreating}
              className="inline-flex items-center cursor-pointer gap-1.5 rounded-md bg-accent-subtle px-3 py-1 text-xs font-bold text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <LoadingSpinner className="h-3 w-3" />
                  Creating...
                </>
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

function PrStatusIcon({
  pullRequestUrl,
  pullRequestState,
}: {
  pullRequestUrl: string | null;
  pullRequestState: PullRequestState | null;
}) {
  if (pullRequestState === "merged") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center shrink-0 rounded bg-purple-500/15 p-1">
            <GitMerge className="h-3.5 w-3.5 text-purple-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Merged</TooltipContent>
      </Tooltip>
    );
  }

  if (pullRequestState === "closed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center shrink-0 rounded bg-danger/15 p-1">
            <GitPullRequestClosed className="h-3.5 w-3.5 text-danger" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Closed</TooltipContent>
      </Tooltip>
    );
  }

  if (pullRequestUrl) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center shrink-0 rounded bg-green-500/15 p-1">
            <GitPullRequest className="h-3.5 w-3.5 text-green-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Open</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <span className="inline-flex items-center justify-center shrink-0 rounded bg-foreground/10 p-1">
      <GitBranch className="h-3.5 w-3.5 text-foreground-muted" />
    </span>
  );
}
