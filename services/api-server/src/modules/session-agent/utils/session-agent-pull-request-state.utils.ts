import { PullRequestClientState, type ClientState } from "@repo/shared";

export function normalizePullRequestState(value: unknown): ClientState["pullRequest"] | null {
  const parseResult = PullRequestClientState.safeParse(value);
  if (parseResult.success) {
    return parseResult.data.status === "creating" ? null : parseResult.data;
  }

  return null;
}
