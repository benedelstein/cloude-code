"use client";

import { useState } from "react";

interface ToolCallPartProps {
  part: {
    type: string;
    toolCallId?: string;
    input?: unknown;
    output?: unknown;
    state?: string;
  };
}

export function ToolCallPart({ part }: ToolCallPartProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Extract tool info from the part
  // The type is like "tool-readFile" and the part has input/output
  const toolName = part.type.replace("tool-", "");
  const hasOutput = part.output !== undefined;
  const state = part.state;

  return (
    <div className="my-2 border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-left"
      >
        <div className="w-6 h-6 rounded bg-accent/10 flex items-center justify-center flex-shrink-0">
          <ToolIcon />
        </div>
        <span className="font-medium text-sm flex-1 truncate">{toolName}</span>

        {/* Status indicator */}
        <span className="text-xs text-muted-foreground">
          {state === "output-available" || hasOutput ? (
            <span className="text-green-500">Completed</span>
          ) : state === "input-available" ? (
            <span className="text-yellow-500">Pending</span>
          ) : (
            <span className="text-blue-500">Running...</span>
          )}
        </span>

        <ChevronIcon isExpanded={isExpanded} />
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="p-3 border-t border-border space-y-3">
          {/* Input */}
          {part.input !== undefined && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">
                Input
              </h4>
              <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto">
                {JSON.stringify(part.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {hasOutput && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">
                Output
              </h4>
              <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto max-h-48">
                {formatOutput(part.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (output && typeof output === "object" && "content" in output) {
    const content = (output as { content: Array<{ text?: string }> }).content;
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item === "object" && item.text ? item.text : JSON.stringify(item)))
        .join("\n");
    }
  }
  return JSON.stringify(output, null, 2);
}

function ToolIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-accent"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
      />
    </svg>
  );
}

function ChevronIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-muted-foreground transition-transform ${
        isExpanded ? "rotate-180" : ""
      }`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
