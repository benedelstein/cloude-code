"use client";

import type { BashAction } from "@repo/shared";
import { ExpandableSummary } from "./expandable-summary";

interface BashPartProps {
  action: BashAction;
}

export function BashPart({ action }: BashPartProps) {
  const firstLine = action.command.split("\n")[0] ?? "";
  return (
    <ExpandableSummary
      summary={<CommandSummary command={firstLine} />}
      status={typeof action.exitCode === "number" && action.exitCode !== 0 ? `exit ${action.exitCode}` : undefined}
      detail={<BashOutput action={action} />}
      disabled={action.output === undefined || action.output.length === 0}
    />
  );
}

function CommandSummary({ command }: { command: string }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-2 font-mono">
      <span className="shrink-0 w-4 text-center text-current" aria-hidden="true">$</span>
      <span className="min-w-0 truncate">{command || "(no command)"}</span>
    </span>
  );
}

function BashOutput({ action }: { action: BashAction }) {
  return (
    <>
      {action.output !== undefined && action.output.length > 0 && (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground-muted whitespace-pre-wrap wrap-break-word">
          {action.output}
        </pre>
      )}
    </>
  );
}

function PromptIcon() {
  return <span className="font-mono text-[13px] leading-none">$</span>;
}

interface BashGroupPartProps {
  actions: BashAction[];
}

export function BashGroupPart({ actions }: BashGroupPartProps) {
  return (
    <ExpandableSummary
      icon={<PromptIcon />}
      summary={`Ran ${actions.length} commands`}
      detail={
        <div className="my-1 space-y-1 pl-3">
          {actions.map((action, index) => (
            <ExpandableSummary
              key={index}
              summary={<CommandSummary command={action.command.split("\n")[0] ?? ""} />}
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
