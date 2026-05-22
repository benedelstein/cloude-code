"use client";

import { useMemo, useState } from "react";
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
  const parsed = useMemo(() => parseDiff(action.diff), [action.diff]);
  return (
    <ExpandableSummary
      icon={<Pencil className="w-3.5 h-3.5" />}
      summary={
        <>
          Edited <span className="font-mono text-current">{name}</span>
          {action.diff && (
            <>
              {" "}
              <DiffStat added={parsed.added} removed={parsed.removed} />
            </>
          )}
        </>
      }
      detail={
        action.diff
          ? <DiffView parsed={parsed} filename={name} />
          : <span className="text-xs text-foreground-muted">(no diff yet)</span>
      }
    />
  );
}

function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      <span className="font-semibold text-green-700 dark:text-green-300">+{added}</span>
      <span className="font-semibold text-red-700 dark:text-red-300">-{removed}</span>
    </span>
  );
}

type DiffLineKind = "context" | "added" | "removed" | "hunk";

interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

interface ParsedDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

function parseDiff(diff: string): ParsedDiff {
  const out: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = /@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/.exec(raw);
      if (match) {
        oldLine = parseInt(match[1]!, 10);
        newLine = parseInt(match[2]!, 10);
      }
      out.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) {
      // File headers (rare here) — skip rendering, do not consume line numbers.
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ kind: "added", text: raw.slice(1), newLineNo: newLine });
      newLine++;
      added++;
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({ kind: "removed", text: raw.slice(1), oldLineNo: oldLine });
      oldLine++;
      removed++;
      continue;
    }
    // Context line (space prefix or no prefix)
    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    out.push({ kind: "context", text, oldLineNo: oldLine, newLineNo: newLine });
    oldLine++;
    newLine++;
  }

  return { lines: out, added, removed };
}

interface DiffViewProps {
  parsed: ParsedDiff;
  filename?: string;
}

function DiffView({ parsed, filename }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);
  const isTruncated = !expanded && parsed.lines.length > MAX_VISIBLE_LINES;
  const visible = isTruncated ? parsed.lines.slice(0, MAX_VISIBLE_LINES) : parsed.lines;
  const remaining = parsed.lines.length - MAX_VISIBLE_LINES;

  return (
    <div className="my-1 rounded-md border border-border overflow-hidden bg-background text-xs">
      {(filename || parsed.added || parsed.removed) && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-muted/30">
          <span className="font-mono text-foreground-muted truncate">{filename ?? ""}</span>
          <span className="shrink-0 font-mono text-foreground-muted">
            <span className="font-semibold text-green-700 dark:text-green-300">+{parsed.added}</span>
            {" "}
            <span className="font-semibold text-red-700 dark:text-red-300">-{parsed.removed}</span>
          </span>
        </div>
      )}
      <div className="overflow-x-auto font-mono leading-relaxed">
        {visible.map((line, index) => (
          <DiffRow key={index} line={line} />
        ))}
      </div>
      {isTruncated && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-border px-3 py-1.5 text-xs text-foreground-muted hover:bg-muted/40 cursor-pointer"
        >
          Show {remaining} more lines
        </button>
      )}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === "hunk") {
    return (
      <div className="px-3 py-0.5 bg-muted/20 text-foreground-muted border-y border-border">
        {line.text}
      </div>
    );
  }
  const bgClass = line.kind === "added"
    ? "bg-green-100/90 dark:bg-green-950/50"
    : line.kind === "removed"
      ? "bg-red-100/90 dark:bg-red-950/50"
      : "";
  const stripeClass = line.kind === "added"
    ? "bg-green-600"
    : line.kind === "removed"
      ? "bg-red-600"
      : "bg-transparent";
  const textClass = line.kind === "added"
    ? "text-green-950 dark:text-green-200"
    : line.kind === "removed"
      ? "text-red-950 dark:text-red-200"
      : "text-foreground";

  return (
    <div className={clsx("flex items-stretch", bgClass)}>
      <span className={clsx("w-0.5 shrink-0", stripeClass)} />
      <span className="w-10 shrink-0 select-none text-right pr-2 text-foreground-muted/70 tabular-nums">
        {line.oldLineNo ?? ""}
      </span>
      <span className="w-10 shrink-0 select-none text-right pr-3 text-foreground-muted/70 tabular-nums">
        {line.newLineNo ?? ""}
      </span>
      <span className={clsx("whitespace-pre flex-1 pr-3", textClass)}>
        {line.text || " "}
      </span>
    </div>
  );
}
