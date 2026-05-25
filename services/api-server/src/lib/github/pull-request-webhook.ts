import type { PullRequestState } from "@repo/shared";

export function mapPullRequestWebhookState(
  action: string,
  merged: boolean,
): PullRequestState | null {
  switch (action) {
    case "closed":
      return merged ? "merged" : "closed";
    case "opened":
    case "reopened":
    case "synchronize":
    case "edited":
      return "open";
    default:
      return null;
  }
}
