import { GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import type { PullRequestState } from "@repo/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function PrStatusIcon({
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
          <span
            role="img"
            aria-label="Merged pull request"
            className="inline-flex items-center justify-center shrink-0 rounded bg-purple-500/15 p-1"
          >
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
          <span
            role="img"
            aria-label="Closed pull request"
            className="inline-flex items-center justify-center shrink-0 rounded bg-danger/15 p-1"
          >
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
          <span
            role="img"
            aria-label="Open pull request"
            className="inline-flex items-center justify-center shrink-0 rounded bg-green-500/15 p-1"
          >
            <GitPullRequest className="h-3.5 w-3.5 text-green-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Open</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <span
      role="img"
      aria-label="Pushed branch"
      className="inline-flex items-center justify-center shrink-0 rounded bg-foreground/10 p-1"
    >
      <GitBranch className="h-3.5 w-3.5 text-foreground-muted" />
    </span>
  );
}
