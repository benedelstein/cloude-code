"use client";

import type { UIMessage } from "ai";
import { isTextUIPart, isReasoningUIPart, isToolUIPart } from "ai";
import { User } from "lucide-react";
import { TextPart } from "@/components/parts/text-part";
import { ToolCallPart } from "@/components/parts/tool-call-part";
import { TodoWritePart } from "@/components/parts/todo-write-part";
import { ExitPlanModePart } from "@/components/parts/exit-plan-mode-part";
import { BashPart } from "@/components/parts/bash-part";
import { ReasoningPart } from "@/components/parts/reasoning-part";

interface MessageItemProps {
  message: UIMessage;
  isStreaming?: boolean;
  userAvatarUrl?: string | null;
}

function isImageFilePart(
  part: unknown,
): part is { type: "file"; url: string; mediaType?: string; filename?: string } {
  if (!part || typeof part !== "object") {
    return false;
  }
  const candidate = part as {
    type?: unknown;
    url?: unknown;
    mediaType?: unknown;
  };
  return candidate.type === "file"
    && typeof candidate.url === "string"
    && (typeof candidate.mediaType === "string"
      ? candidate.mediaType.startsWith("image/")
      : true);
}

function resolveAttachmentUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  if (url.startsWith("/api/")) {
    return url;
  }
  if (url.startsWith("/")) {
    return `/api${url}`;
  }
  return `/api/${url}`;
}

export function MessageItem({ message, userAvatarUrl }: MessageItemProps) {
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
          {/* Message Content */}
          <div className="flex-1 min-w-0">
            <div
              className={`rounded-md ${
                isUser
                  ? "px-3 py-2 bg-accent-subtle text-accent-foreground"
                  : ""
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

                if (isImageFilePart(part)) {
                  return (
                    <div key={key} className="mb-2">
                      <img
                        src={resolveAttachmentUrl(part.url)}
                        alt={part.filename ?? "Uploaded image"}
                        className="max-h-96 max-w-full rounded-md border border-border"
                      />
                    </div>
                  );
                }

                if (!part || typeof part !== "object" || !("type" in part)) {
                  return null;
                }

                if (part.type === "step-start") {
                  return null;
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
            userAvatarUrl ? (
              <img
                src={userAvatarUrl}
                alt="You"
                className="flex-shrink-0 w-8 h-8 rounded-full"
              />
            ) : (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                <User className="w-4 h-4 text-accent-foreground" />
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
