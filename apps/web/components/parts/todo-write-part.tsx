"use client";

import { isProviderTodoToolName } from "@repo/shared";

interface TodoToolPartProps {
  part: {
    type: string;
    toolName?: string;
    args?: unknown;
    input?: unknown;
    state?: string;
  };
}

/**
 * Returns true when the part represents a provider todo-update tool.
 *
 * @param toolName Tool name resolved from the message part.
 * @returns Whether the part should render with the specialized todo UI.
 */
export function isTodoToolName(toolName: string): boolean {
  return isProviderTodoToolName(toolName);
}

export function TodoToolPart({ part }: TodoToolPartProps) {
  const state = part.state;
  const statusLabel = state === "output-available"
    ? "Completed"
    : state === "input-available"
      ? "Pending"
      : "Running...";
  const statusClassName = state === "output-available"
    ? "text-green-500"
    : state === "input-available"
      ? "text-yellow-500"
      : "text-blue-500";

  return (
    <div className="my-2 border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
        <ListIcon />
        <span className="font-medium text-sm flex-1">Updated todos</span>
        <span className={`text-xs ${statusClassName}`}>{statusLabel}</span>
      </div>
    </div>
  );
}

function ListIcon() {
  return (
    <svg
      className="w-4 h-4 text-muted-foreground"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
      />
    </svg>
  );
}
