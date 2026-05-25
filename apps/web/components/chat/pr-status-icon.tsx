import {
  createLucideIcon,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
} from "lucide-react";
import type { PullRequestState } from "@repo/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const GitBranch = createLucideIcon("GitBranch", [
  ["line", { x1: "6", x2: "6", y1: "3", y2: "15", key: "1o40i7" }],
  ["circle", { cx: "18", cy: "6", r: "3", key: "1r07d4" }],
  ["circle", { cx: "6", cy: "18", r: "3", key: "fqmcym" }],
  ["path", { d: "M18 9a9 9 0 0 1-9 9", key: "n2h4wq" }],
]);

export function PrStatusIcon({
  pullRequestUrl,
  pullRequestState,
  variant = "framed",
}: {
  pullRequestUrl: string | null;
  pullRequestState: PullRequestState | null;
  variant?: "framed" | "plain";
}) {
  const baseClassName = "inline-flex items-center justify-center shrink-0";
  const iconClassName = variant === "framed" ? "h-3.5 w-3.5" : "h-3 w-3";

  if (pullRequestState === "merged") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label="Merged pull request"
            className={cn(
              baseClassName,
              "text-purple-500",
              variant === "framed" && "rounded bg-purple-500/15 p-1",
            )}
          >
            <GitMerge className={iconClassName} />
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
            className={cn(
              baseClassName,
              "text-danger",
              variant === "framed" && "rounded bg-danger/15 p-1",
            )}
          >
            <GitPullRequestClosed className={iconClassName} />
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
            className={cn(
              baseClassName,
              "text-green-600",
              variant === "framed" && "rounded bg-green-500/15 p-1",
            )}
          >
            <GitPullRequest className={iconClassName} />
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
      className={cn(
        baseClassName,
        "text-foreground-tertiary",
        variant === "framed" && "rounded bg-foreground/10 p-1",
      )}
    >
      <GitBranch className={iconClassName} />
    </span>
  );
}
