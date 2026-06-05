import type { ClientState, PullRequestState } from "@repo/shared";

function isPullRequestState(value: unknown): value is PullRequestState {
  return value === "open" || value === "merged" || value === "closed";
}

export function normalizePullRequestState(value: unknown): ClientState["pullRequest"] | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const pullRequest = value as Record<string, unknown>;
  if (
    pullRequest.status === "created"
    && typeof pullRequest.url === "string"
    && typeof pullRequest.number === "number"
    && isPullRequestState(pullRequest.state)
  ) {
    return {
      status: "created",
      url: pullRequest.url,
      number: pullRequest.number,
      state: pullRequest.state,
    };
  }

  if (pullRequest.status === "creating") {
    return null;
  }

  if (pullRequest.status === "failed" && typeof pullRequest.error === "string") {
    return {
      status: "failed",
      error: pullRequest.error,
      ...(typeof pullRequest.details === "string" ? { details: pullRequest.details } : {}),
    };
  }

  if (
    typeof pullRequest.url === "string"
    && typeof pullRequest.number === "number"
    && isPullRequestState(pullRequest.state)
  ) {
    return {
      status: "created",
      url: pullRequest.url,
      number: pullRequest.number,
      state: pullRequest.state,
    };
  }

  return null;
}
