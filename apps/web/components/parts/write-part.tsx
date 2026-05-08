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
      summary={<>{label} <span className="font-mono">{name}</span></>}
      detail={
        action.content
          ? (
            <pre className="my-1 max-h-72 overflow-auto rounded bg-background/40 px-2 py-1 font-mono text-xs whitespace-pre-wrap">
              {action.content}
            </pre>
          )
          : undefined
      }
    />
  );
}
