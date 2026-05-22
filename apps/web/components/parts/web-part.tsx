"use client";

import { Globe } from "lucide-react";
import type { WebAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

function hostname(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface WebPartProps {
  action: WebAction;
}

export function WebPart({ action }: WebPartProps) {
  const summary = action.kind === "fetch"
    ? <>Fetched <span className="font-mono text-current">{hostname(action.url) || "(no url)"}</span></>
    : <>Web search <span className="font-mono text-current">&quot;{action.query ?? ""}&quot;</span></>;
  return (
    <ExpandableSummary
      icon={<Globe className="w-3.5 h-3.5" />}
      summary={summary}
      detail={
        <div className="my-1 text-xs text-foreground-muted font-mono break-all">
          {action.kind === "fetch" ? action.url : action.query}
        </div>
      }
    />
  );
}

interface WebGroupPartProps {
  actions: WebAction[];
}

export function WebGroupPart({ actions }: WebGroupPartProps) {
  return (
    <ExpandableSummary
      icon={<Globe className="w-3.5 h-3.5" />}
      summary={`Web requests (${actions.length})`}
      detail={
        <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-muted">
          {actions.map((action, index) => (
            <li key={index}>
              {action.kind === "fetch"
                ? `fetch: ${action.url ?? ""}`
                : `search: ${action.query ?? ""}`}
            </li>
          ))}
        </ul>
      }
    />
  );
}
