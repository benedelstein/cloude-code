"use client";

import { useState, useEffect, useCallback } from "react";
import { ExternalLink, Copy, Check } from "lucide-react";
import { ApiError, createPullRequest, getPullRequestStatus } from "@/lib/client-api";
import type { ClientState } from "@repo/shared";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import { PrStatusIcon } from "@/components/chat/pr-status-icon";

const POLL_INTERVAL_MS = 30_000;

interface BranchBarProps {
  sessionId: string;
  baseBranch: string | null;
  pushedBranch: string | null;
  pullRequestState: ClientState["pullRequest"] | null;
}

export function BranchBar({
  sessionId,
  baseBranch,
  pushedBranch,
  pullRequestState,
}: BranchBarProps) {
  const createdPullRequest = pullRequestState?.status === "created" ? pullRequestState : null;
  const failedPullRequest = pullRequestState?.status === "failed" ? pullRequestState : null;
  const isCreatingPullRequest = pullRequestState?.status === "creating";
  const url = createdPullRequest?.url ?? null;
  const state = createdPullRequest?.state ?? null;
  const displayBaseBranch = baseBranch ?? "main";
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const showCreating = isCreating || isCreatingPullRequest;
  const displayError = showCreating
    ? null
    : error ?? failedPullRequest?.details ?? failedPullRequest?.error ?? null;

  const copyBranchName = useCallback(async () => {
    if (!pushedBranch) { return; }
    await navigator.clipboard.writeText(pushedBranch);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pushedBranch]);

  // Poll PR status when PR exists and is open
  useEffect(() => {
    if (!url || state !== "open") { return; }

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
  }, [sessionId, url, state]);

  const handleCreatePR = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    try {
      const result = await createPullRequest(sessionId);
      // Open the PR in a new tab
      window.open(result.url, "_blank");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.details ?? err.message);
      } else {
        setError(err instanceof Error ? err.message : "Failed to create PR");
      }
    } finally {
      setIsCreating(false);
    }
  }, [sessionId]);

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
          <span className="text-foreground font-medium">{displayBaseBranch}</span>
          {" \u2190 "}
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
