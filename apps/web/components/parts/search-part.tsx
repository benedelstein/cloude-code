"use client";

import { Search } from "lucide-react";
import type { SearchAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

interface SearchPartProps {
  action: SearchAction;
}

export function SearchPart({ action }: SearchPartProps) {
  const pattern = action.patterns[0] ?? "(no pattern)";
  return (
    <ExpandableSummary
      icon={<Search className="w-3.5 h-3.5" />}
      summary={<>Searched <span className="font-mono text-foreground-muted">&quot;{pattern}&quot;</span></>}
      detail={
        <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-muted">
          {action.patterns.map((p, index) => (
            <li key={`${p}-${index}`}>{p}</li>
          ))}
        </ul>
      }
    />
  );
}

interface SearchGroupPartProps {
  actions: SearchAction[];
}

export function SearchGroupPart({ actions }: SearchGroupPartProps) {
  const total = actions.reduce((sum, action) => sum + action.patterns.length, 0);
  return (
    <ExpandableSummary
      icon={<Search className="w-3.5 h-3.5" />}
      summary={`Searched ${total} patterns`}
      detail={
        <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-muted">
          {actions.flatMap((action) => action.patterns).map((p, index) => (
            <li key={`${p}-${index}`}>{p}</li>
          ))}
        </ul>
      }
    />
  );
}
