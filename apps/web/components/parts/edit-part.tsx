"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import clsx from "clsx";
import type { EditAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

const MAX_VISIBLE_LINES = 200;

function basename(path: string): string {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

interface EditPartProps {
  action: EditAction;
}

export function EditPart({ action }: EditPartProps) {
  const name = basename(action.path) || "(unknown)";
  return (
    <ExpandableSummary
      icon={<Pencil className="w-3.5 h-3.5" />}
      summary={<>Edited <span className="font-mono">{name}</span></>}
      detail={action.diff ? <DiffView diff={action.diff} /> : <span className="text-xs text-foreground-muted">(no diff yet)</span>}
    />
  );
}

interface DiffViewProps {
  diff: string;
}

function DiffView({ diff }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = diff.split("\n");
  const isTruncated = !expanded && lines.length > MAX_VISIBLE_LINES;
  const visible = isTruncated ? lines.slice(0, MAX_VISIBLE_LINES) : lines;
  return (
    <div className="my-1">
      <pre className="rounded bg-background/40 px-2 py-1 text-xs leading-snug overflow-x-auto">
        {visible.map((line, index) => (
          <div
            key={index}
            className={clsx(
              "font-mono whitespace-pre",
              line.startsWith("+") && "bg-green-500/10 text-green-700 dark:text-green-400",
              line.startsWith("-") && "bg-red-500/10 text-red-700 dark:text-red-400",
            )}
          >
            {line || " "}
          </div>
        ))}
      </pre>
      {lines.length > MAX_VISIBLE_LINES && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-xs text-accent hover:underline"
        >
          {expanded ? "Show less" : `Show ${lines.length - MAX_VISIBLE_LINES} more lines`}
        </button>
      )}
    </div>
  );
}
