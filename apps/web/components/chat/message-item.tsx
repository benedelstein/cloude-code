"use client";

import type { UIMessage } from "ai";
import { isTextUIPart, isReasoningUIPart, isToolUIPart } from "ai";
import { TextPart } from "@/components/parts/text-part";
import { ToolCallPart } from "@/components/parts/tool-call-part";
import { TodoWritePart } from "@/components/parts/todo-write-part";
import { ExitPlanModePart } from "@/components/parts/exit-plan-mode-part";
import { ReasoningPart } from "@/components/parts/reasoning-part";

interface MessageItemProps {
  message: UIMessage;
  isStreaming?: boolean;
}

export function MessageItem({ message, isStreaming = false }: MessageItemProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] ${isUser ? "order-1" : "order-1"}`}
      >
        <div className="flex items-start gap-3">
          {/* Avatar */}
          {!isUser && (
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-accent"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}

          {/* Message Content */}
          <div className="flex-1 min-w-0">
            <div
              className={`rounded-lg px-4 py-3 ${
                isUser
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted"
              }`}
            >
              {message.parts?.map((part, index) => {
                const key = `${message.id}-${index}`;

                if (isTextUIPart(part)) {
                  return (
                    <TextPart
                      key={key}
                      text={part.text}
                      isUser={isUser}
                    />
                  );
                }

                if (isReasoningUIPart(part)) {
                  return (
                    <ReasoningPart
                      key={key}
                      text={part.text}
                    />
                  );
                }

                if (part.type === "step-start") {
                  return (
                    <div
                      key={key}
                      className="my-2 border-t border-border/50"
                    />
                  );
                }

                // Handle tool calls - they start with "tool-" prefix
                if (isToolUIPart(part) || part.type.startsWith("tool-")) {
                  const toolName = (part as { toolName?: string }).toolName ?? part.type.replace(/^tool-/, "");
                  if (toolName === "TodoWrite") {
                    return <TodoWritePart key={key} part={part} />;
                  }
                  if (toolName === "ExitPlanMode") {
                    return <ExitPlanModePart key={key} part={part} />;
                  }
                  return (
                    <ToolCallPart
                      key={key}
                      part={part}
                    />
                  );
                }

                return null;
              })}

              {/* Streaming cursor */}
              {isStreaming && !isUser && (
                <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
              )}
            </div>
          </div>

          {/* User avatar on right */}
          {isUser && (
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <svg
                className="w-4 h-4 text-accent-foreground"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
