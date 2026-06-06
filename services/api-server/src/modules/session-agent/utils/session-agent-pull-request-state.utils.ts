import { PullRequestClientState, type ClientState } from "@repo/shared";

/**
 * Restores pull request client state after a Durable Object restart.
 * `creating` is an in-memory lock around an async GitHub create call and cannot
 * be resumed after restart, so it is cleared while created/failed states remain.
 */
export function normalizePullRequestState(value: unknown): ClientState["pullRequest"] | null {
  const parseResult = PullRequestClientState.safeParse(value);
  if (parseResult.success) {
    return parseResult.data.status === "creating" ? null : parseResult.data;
  }
  return null;
}
