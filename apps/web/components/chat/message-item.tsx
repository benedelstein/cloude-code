"use client";

import type { UIMessage } from "ai";
import { isTextUIPart, isReasoningUIPart, isToolUIPart } from "ai";
import { Monitor, User } from "lucide-react";
import { TextPart } from "@/components/parts/text-part";
import { ToolCallPart } from "@/components/parts/tool-call-part";
import { TodoWritePart } from "@/components/parts/todo-write-part";
import { ExitPlanModePart } from "@/components/parts/exit-plan-mode-part";
import { BashPart } from "@/components/parts/bash-part";
import { ReasoningPart } from "@/components/parts/reasoning-part";

interface MessageItemProps {
  message: UIMessage;
  isStreaming?: boolean;
}

export function MessageItem({ message, isStreaming = false }: MessageItemProps) {
  const isUser = message.role === "user";
  const isAborted = !isUser && (message.metadata as Record<string, unknown>)?.aborted === true;

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
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-subtle flex items-center justify-center">
              <Monitor className="w-4 h-4 text-accent" />
            </div>
          )}

          {/* Message Content */}
          <div className="flex-1 min-w-0">
            <div
              className={`rounded-lg px-4 py-3 ${
                isUser
                  ? "bg-accent text-accent-foreground"
                  : "bg-background-secondary"
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
                  if (toolName.toLowerCase() === "bash") {
                    return <BashPart key={key} part={part} />;
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

            {/* Interrupted label for aborted messages */}
            {isAborted && (
              <p className="mt-1.5 text-xs text-foreground-muted italic">
                Interrupted
              </p>
            )}
          </div>

          {/* User avatar on right */}
          {isUser && (
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
              <User className="w-4 h-4 text-accent-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
