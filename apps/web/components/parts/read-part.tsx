"use client";

import { FileText } from "lucide-react";
import type { ReadAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function displayPath(path: string): string {
  const spriteWorkspacePrefix = "/home/sprite/workspace/";
  if (!path.startsWith(spriteWorkspacePrefix)) return path;

  const pathInWorkspace = path.slice(spriteWorkspacePrefix.length);
  const slashIndex = pathInWorkspace.indexOf("/");
  if (slashIndex === -1) return pathInWorkspace;
  return pathInWorkspace.slice(slashIndex + 1);
}

interface ReadPartProps {
  action: ReadAction;
}

export function ReadPart({ action }: ReadPartProps) {
  const paths = action.paths.map(displayPath);
  const name = paths.length > 0 ? basename(paths[0]!) : "(unknown)";
  return (
    <ExpandableSummary
      icon={<FileText className="w-3.5 h-3.5" />}
      summary={<>Read <span className="font-mono text-foreground-muted">{name}</span></>}
      detail={
        paths.length > 0 ? (
          <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-muted">
            {paths.map((path) => (
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
  const paths = actions.flatMap((action) => action.paths).map(displayPath);
  return (
    <ExpandableSummary
      icon={<FileText className="w-3.5 h-3.5" />}
      summary={`Read ${total} files`}
      detail={
        <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-muted">
          {paths.map((path, index) => (
            <li key={`${path}-${index}`}>{path}</li>
          ))}
        </ul>
      }
    />
  );
}
