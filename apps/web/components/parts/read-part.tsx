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

function lineRangeLabel(action: ReadAction): string | undefined {
  if (!action.lineRange) return undefined;
  if (action.lineRange.end === undefined) return `L${action.lineRange.start}+`;
  return `L${action.lineRange.start}-${action.lineRange.end}`;
}

interface ReadPartProps {
  action: ReadAction;
}

export function ReadPart({ action }: ReadPartProps) {
  const paths = action.paths.map(displayPath);
  const name = paths.length > 0 ? basename(paths[0]!) : "(unknown)";
  const rangeLabel = lineRangeLabel(action);
  return (
    <ExpandableSummary
      icon={<FileText className="w-3.5 h-3.5" />}
      summary={
        <>
          Read <span className="font-mono text-current">{name}</span>
          {rangeLabel && <span className="font-mono text-xs text-current"> ({rangeLabel})</span>}
        </>
      }
      detail={<ReadDetail action={action} paths={paths} />}
      disabled={action.content === undefined && paths.length === 0}
    />
  );
}

function ReadDetail({ action, paths }: { action: ReadAction; paths: string[] }) {
  const label = paths[0] ?? "(unknown)";
  if (action.content !== undefined) {
    return (
      <ReadContent
        content={action.content}
        filename={label}
        rangeLabel={lineRangeLabel(action)}
      />
    );
  }

  if (paths.length === 0) return null;

  return (
    <ul className="my-1 space-y-0.5 font-mono text-xs text-foreground-muted">
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  );
}

function ReadContent({
  content,
  filename,
  rangeLabel,
}: {
  content: string;
  filename?: string;
  rangeLabel?: string;
}) {
  return (
    <div className="my-1 rounded-md border border-border overflow-hidden bg-background text-xs">
      {(filename || rangeLabel) && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-muted/30">
          <span className="font-mono text-foreground-muted truncate">
            {filename ?? ""}
          </span>
          {rangeLabel && (
            <span className="shrink-0 font-mono text-foreground-muted">
              {rangeLabel}
            </span>
          )}
        </div>
      )}
      <pre className="max-h-72 overflow-auto px-3 py-2 font-mono leading-relaxed whitespace-pre">
        {content}
      </pre>
    </div>
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
        <div className="pl-3">
          {actions.map((action, index) => (
            <ReadPart key={`${action.paths[0] ?? "unknown"}-${index}`} action={action} />
          ))}
        </div>
      }
    />
  );
}
