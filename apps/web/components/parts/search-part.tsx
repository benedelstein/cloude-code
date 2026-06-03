"use client";

import { Search } from "lucide-react";
import type { SearchAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

interface SearchPartProps {
  action: SearchAction;
}

export function SearchPart({ action }: SearchPartProps) {
  const pattern = action.patterns[0] ?? "(no pattern)";
  const extraPatterns = action.patterns.slice(1);
  return (
    <ExpandableSummary
      icon={<Search className="w-3.5 h-3.5" />}
      summary={<>Searched <span className="font-mono text-current">&quot;{pattern}&quot;</span></>}
      detail={
        extraPatterns.length > 0 ? (
          <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-secondary">
            {extraPatterns.map((p, index) => (
              <li key={`${p}-${index}`}>{p}</li>
            ))}
          </ul>
        ) : undefined
      }
    />
  );
}

interface SearchGroupPartProps {
  actions: SearchAction[];
  isActive?: boolean;
}

export function SearchGroupPart({ actions, isActive = false }: SearchGroupPartProps) {
  const total = actions.reduce((sum, action) => sum + action.patterns.length, 0);
  return (
    <ExpandableSummary
      icon={<Search className="w-3.5 h-3.5" />}
      summary={`${isActive ? "Searching" : "Searched"} ${total} patterns`}
      detail={
        <ul className="my-1 space-y-0.5 pl-3 font-mono text-xs text-foreground-secondary">
          {actions.flatMap((action) => action.patterns).map((p, index) => (
            <li key={`${p}-${index}`}>{p}</li>
          ))}
        </ul>
      }
    />
  );
}
