"use client";

import { useState, useEffect, useCallback } from "react";
import { createPullRequest, getPullRequestStatus } from "@/lib/api";
import type { PullRequestState } from "@repo/shared";

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

  // Poll PR status when PR exists and is open
  useEffect(() => {
    if (!pullRequestUrl || pullRequestState !== "open") return;

    const interval = setInterval(async () => {
      try {
        await getPullRequestStatus(sessionId);
        // State update comes via onStateUpdate from the DO
      } catch {
        // Silently ignore polling errors
      }
    }, POLL_INTERVAL_MS);

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
    <div className="shrink-0 border-t border-border bg-muted/30">
      <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
          <GitPullRequestIcon />
          <span className="truncate">
            <span className="text-foreground font-medium">main</span>
            {" ← "}
            <span className="text-foreground font-medium">{pushedBranch}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {error && (
            <span className="text-xs text-red-500">{error}</span>
          )}

          {pullRequestState === "merged" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-500">
              Merged
            </span>
          )}

          {pullRequestState === "closed" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-500">
              Closed
            </span>
          )}

          {pullRequestUrl ? (
            <a
              href={pullRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              View PR
              <ExternalLinkIcon />
            </a>
          ) : (
            <button
              onClick={handleCreatePR}
              disabled={isCreating}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <LoadingSpinner />
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

function GitPullRequestIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <line x1="6" y1="9" x2="6" y2="21" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      className="h-3 w-3"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-3 w-3"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
