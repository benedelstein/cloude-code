"use client";

import { FileText } from "lucide-react";
import type { ReadAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

interface ReadPartProps {
  action: ReadAction;
}

export function ReadPart({ action }: ReadPartProps) {
  const name = action.paths.length > 0 ? basename(action.paths[0]!) : "(unknown)";
  return (
    <ExpandableSummary
      icon={<FileText className="w-3.5 h-3.5" />}
      summary={<>Read <span className="font-mono">{name}</span></>}
      detail={
        action.paths.length > 0 ? (
          <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-muted">
            {action.paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        ) : undefined
      }
    />
  );
}

interface ReadGroupPartProps {
  actions: ReadAction[];
}

export function ReadGroupPart({ actions }: ReadGroupPartProps) {
  const total = actions.reduce((sum, action) => sum + action.paths.length, 0);
  return (
    <ExpandableSummary
      icon={<FileText className="w-3.5 h-3.5" />}
      summary={`Read ${total} files`}
      detail={
        <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-muted">
          {actions.flatMap((action) => action.paths).map((path, index) => (
            <li key={`${path}-${index}`}>{path}</li>
          ))}
        </ul>
      }
    />
  );
}
