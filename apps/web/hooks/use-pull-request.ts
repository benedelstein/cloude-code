"use client";

import { useState, useEffect, useCallback } from "react";
import type { ClientState, PullRequestState } from "@repo/shared";
import { ApiError, createPullRequest, getPullRequestStatus } from "@/lib/client-api";

const POLL_INTERVAL_MS = 30_000;

interface UsePullRequestOptions {
  sessionId: string;
  pushedBranch: string | null;
  pullRequestState: ClientState["pullRequest"] | null;
}

export interface UsePullRequestResult {
  /** Created PR URL, or null when no PR exists. */
  url: string | null;
  /** Created PR state, or null when no PR exists. */
  state: PullRequestState | null;
  failedPullRequest: { error: string; details?: string } | null;
  /** True while a PR creation is in flight (local or server-reported). */
  showCreating: boolean;
  /** Latest creation error to surface, or null. */
  displayError: string | null;
  copied: boolean;
  copyBranchName: () => Promise<void>;
  handleCreatePullRequest: () => Promise<void>;
}

/**
 * Owns pull-request actions and status polling for a session: creation,
 * open-PR status polling, and branch-name copy state. State updates arrive
 * via the session WebSocket; this hook only triggers the server work.
 */
export function usePullRequest({
  sessionId,
  pushedBranch,
  pullRequestState,
}: UsePullRequestOptions): UsePullRequestResult {
  const createdPullRequest = pullRequestState?.status === "created" ? pullRequestState : null;
  const failedPullRequest = pullRequestState?.status === "failed" ? pullRequestState : null;
  const isCreatingPullRequest = pullRequestState?.status === "creating";
  const url = createdPullRequest?.url ?? null;
  const state = createdPullRequest?.state ?? null;
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

  const handleCreatePullRequest = useCallback(async () => {
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

  return {
    url,
    state,
    failedPullRequest,
    showCreating,
    displayError,
    copied,
    copyBranchName,
    handleCreatePullRequest,
  };
}
