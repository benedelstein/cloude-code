"use client";

import { Terminal } from "lucide-react";
import type { BashAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

interface BashPartProps {
  action: BashAction;
}

export function BashPart({ action }: BashPartProps) {
  const firstLine = action.command.split("\n")[0] ?? "";
  return (
    <ExpandableSummary
      icon={<Terminal className="w-3.5 h-3.5" />}
      summary={<span className="font-mono">{firstLine || "(no command)"}</span>}
      status={typeof action.exitCode === "number" && action.exitCode !== 0 ? `exit ${action.exitCode}` : undefined}
      detail={<BashOutput action={action} />}
      disabled={action.output === undefined || action.output.length === 0}
    />
  );
}

function BashOutput({ action }: { action: BashAction }) {
  return (
    <>
      {action.output !== undefined && action.output.length > 0 && (
        <pre className="max-h-72 overflow-auto rounded bg-muted/70 text-foreground-muted px-2 py-1 font-mono text-xs whitespace-pre-wrap break-words">
          {action.output}
        </pre>
      )}
    </>
  );
}

interface BashGroupPartProps {
  actions: BashAction[];
}

export function BashGroupPart({ actions }: BashGroupPartProps) {
  return (
    <ExpandableSummary
      icon={<Terminal className="w-3.5 h-3.5" />}
      summary={`Ran ${actions.length} commands`}
      detail={
        <div className="my-1 space-y-1">
          {actions.map((action, index) => (
            <ExpandableSummary
              key={index}
              summary={<span className="font-mono">{action.command.split("\n")[0] || "(no command)"}</span>}
              detail={<BashOutput action={action} />}
              disabled={action.output === undefined || action.output.length === 0}
              className="my-0"
            />
          ))}
        </div>
      }
    />
  );
}
