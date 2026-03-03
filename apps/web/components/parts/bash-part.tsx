"use client";

import { useMemo, useState } from "react";

const COLLAPSED_OUTPUT_LINES = 2;

interface BashPartProps {
  part: {
    type: string;
    toolName?: string;
    args?: unknown;
    input?: unknown;
    result?: unknown;
    output?: unknown;
    state?: string;
  };
}

interface BashInput {
  command?: unknown;
  cmd?: unknown;
}

interface ToolContentItem {
  text?: unknown;
}

interface ToolContentOutput {
  content?: unknown;
}

interface ProcessLikeOutput {
  stdout?: unknown;
  stderr?: unknown;
  output?: unknown;
}

export function BashPart({ part }: BashPartProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const input = (part.args ?? part.input) as BashInput | undefined;
  const output = part.result ?? part.output;
  const command = getCommand(input);
  const outputText = formatOutput(output);
  const hasOutput = outputText.length > 0;
  const outputLines = useMemo(() => outputText.split("\n"), [outputText]);
  const isTruncatable = outputLines.length > COLLAPSED_OUTPUT_LINES;
  const visibleOutput = isExpanded || !isTruncatable
    ? outputText
    : outputLines.slice(0, COLLAPSED_OUTPUT_LINES).join("\n");
  const state = part.state;

  return (
    <div className="my-2 border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
        <BashIcon />
        <span className="font-medium text-sm flex-1">Bash</span>
        <span className="text-xs text-muted-foreground">
          {state === "output-available" || hasOutput ? (
            <span className="text-green-500">Completed</span>
          ) : state === "input-available" ? (
            <span className="text-yellow-500">Pending</span>
          ) : (
            <span className="text-blue-500">Running...</span>
          )}
        </span>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground mb-1">
            Command
          </h4>
          <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto">
            {command}
          </pre>
        </div>

        {(hasOutput || state === "output-available") && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-1">
              Output
            </h4>
            <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
              {hasOutput ? visibleOutput : "(no output)"}
            </pre>
            {isTruncatable && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="mt-2 text-xs text-accent hover:underline"
              >
                {isExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getCommand(input: BashInput | undefined): string {
  if (typeof input?.command === "string" && input.command.trim().length > 0) {
    return input.command;
  }
  if (typeof input?.cmd === "string" && input.cmd.trim().length > 0) {
    return input.cmd;
  }
  return "(no command provided)";
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") {
    return output.trimEnd();
  }

  if (isToolContentOutput(output) && Array.isArray(output.content)) {
    const textContent = output.content
      .map((item) => {
        if (isToolContentItem(item) && typeof item.text === "string") {
          return item.text;
        }
        return JSON.stringify(item);
      })
      .join("\n")
      .trimEnd();
    if (textContent.length > 0) {
      return textContent;
    }
  }

  if (isProcessLikeOutput(output)) {
    const sections: string[] = [];
    if (typeof output.stdout === "string" && output.stdout.trim().length > 0) {
      sections.push(output.stdout.trimEnd());
    }
    if (typeof output.stderr === "string" && output.stderr.trim().length > 0) {
      sections.push(output.stderr.trimEnd());
    }
    if (sections.length > 0) {
      return sections.join("\n");
    }
    if (typeof output.output === "string" && output.output.trim().length > 0) {
      return output.output.trimEnd();
    }
  }

  if (output === undefined || output === null) {
    return "";
  }

  return JSON.stringify(output, null, 2);
}

function isToolContentOutput(value: unknown): value is ToolContentOutput {
  return typeof value === "object" && value !== null && "content" in value;
}

function isToolContentItem(value: unknown): value is ToolContentItem {
  return typeof value === "object" && value !== null && "text" in value;
}

function isProcessLikeOutput(value: unknown): value is ProcessLikeOutput {
  return (
    typeof value === "object"
    && value !== null
    && ("stdout" in value || "stderr" in value || "output" in value)
  );
}

function BashIcon() {
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
        d="M4.5 6.75h15A2.25 2.25 0 0121.75 9v6A2.25 2.25 0 0119.5 17.25h-15A2.25 2.25 0 012.25 15V9A2.25 2.25 0 014.5 6.75z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 10.5l2 1.5-2 1.5M11.5 13.5h3.5"
      />
    </svg>
  );
}
