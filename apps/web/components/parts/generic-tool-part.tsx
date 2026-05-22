"use client";

import { Wrench } from "lucide-react";
import type { OtherAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

interface GenericToolPartProps {
  action: OtherAction;
}

export function GenericToolPart({ action }: GenericToolPartProps) {
  return (
    <ExpandableSummary
      icon={<Wrench className="w-3.5 h-3.5" />}
      summary={<span className="font-mono">{action.toolName}</span>}
      detail={
        <div className="my-1 space-y-2 text-xs">
          {action.input !== undefined && (
            <div>
              <div className="mb-1 text-foreground-muted">Input</div>
              <pre className="rounded bg-background/40 px-2 py-1 font-mono whitespace-pre-wrap wrap-break-word">
                {safeStringify(action.input)}
              </pre>
            </div>
          )}
          {action.output !== undefined && (
            <div>
              <div className="mb-1 text-foreground-muted">Output</div>
              <pre className="max-h-60 overflow-auto rounded bg-background/40 px-2 py-1 font-mono whitespace-pre-wrap wrap-break-word">
                {safeStringify(action.output)}
              </pre>
            </div>
          )}
        </div>
      }
    />
  );
}

interface GenericGroupPartProps {
  actions: OtherAction[];
}

export function GenericGroupPart({ actions }: GenericGroupPartProps) {
  return (
    <ExpandableSummary
      icon={<Wrench className="w-3.5 h-3.5" />}
      summary={`Tools (${actions.length})`}
      detail={
        <ul className="my-1 space-y-0.5 pl-3 font-mono text-xs text-foreground-muted">
          {actions.map((action, index) => (
            <li key={index}>{action.toolName}</li>
          ))}
        </ul>
      }
    />
  );
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
