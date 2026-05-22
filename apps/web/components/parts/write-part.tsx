"use client";

import { FilePlus, FileMinus, FileText } from "lucide-react";
import type { WriteAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

function basename(path: string): string {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

interface WritePartProps {
  action: WriteAction;
}

export function WritePart({ action }: WritePartProps) {
  const name = basename(action.path) || "(unknown)";
  const { icon, label } = action.deleted
    ? { icon: <FileMinus className="w-3.5 h-3.5" />, label: "Deleted" }
    : action.isNew
      ? { icon: <FilePlus className="w-3.5 h-3.5" />, label: "Created" }
      : { icon: <FileText className="w-3.5 h-3.5" />, label: "Wrote" };
  return (
    <ExpandableSummary
      icon={icon}
      summary={<>{label} <span className="font-mono text-current">{name}</span></>}
      detail={
        action.content
          ? <WriteContent content={action.content} filename={name} />
          : undefined
      }
    />
  );
}

function WriteContent({ content, filename }: { content: string; filename: string }) {
  return (
    <div className="my-1 rounded-md border border-border overflow-hidden bg-background text-xs">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-muted/30">
        <span className="font-mono text-foreground-muted truncate">{filename}</span>
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2 font-mono leading-relaxed whitespace-pre">
        {content}
      </pre>
    </div>
  );
}
