"use client";

import { useEffect, useState } from "react";
import type { UIMessage } from "ai";
import { isTextUIPart, isReasoningUIPart, isToolUIPart } from "ai";
import { User } from "lucide-react";
import { createPortal } from "react-dom";
import { TextPart } from "@/components/parts/text-part";
import { ToolCallPart } from "@/components/parts/tool-call-part";
import { ExitPlanModePart } from "@/components/parts/exit-plan-mode-part";
import { BashPart } from "@/components/parts/bash-part";
import { ReasoningPart } from "@/components/parts/reasoning-part";

interface MessageItemProps {
  message: UIMessage;
  isStreaming?: boolean;
  userAvatarUrl?: string | null;
}

type ImageFilePart = { type: "file"; url: string; mediaType?: string; filename?: string };

function isImageFilePart(
  part: unknown,
): part is ImageFilePart {
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
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!expandedImageUrl) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpandedImageUrl(null);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expandedImageUrl]);

  const orderedParts = (message.parts ?? [])
    .map((part, index) => ({ part, index }))
    .sort((left, right) => {
      const leftIsImage = isImageFilePart(left.part);
      const rightIsImage = isImageFilePart(right.part);
      if (leftIsImage === rightIsImage) {
        return left.index - right.index;
      }
      return leftIsImage ? -1 : 1;
    });
  const imageParts = orderedParts.flatMap(({ part, index }) => (
    isImageFilePart(part) ? [{ part, index }] : []
  ));
  const nonImageParts = orderedParts.filter(({ part }) => !isImageFilePart(part));

  return (
    <>
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
                {imageParts.length > 0 && (
                  <div className="mb-2 flex items-end gap-2 overflow-x-auto pb-1 justify-end">
                    {imageParts.map(({ part, index }) => {
                      const key = `${message.id}-image-${index}`;
                      const imageUrl = resolveAttachmentUrl(part.url);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setExpandedImageUrl(imageUrl)}
                          className="block w-32 shrink-0 cursor-zoom-in"
                        >
                          <img
                            src={imageUrl}
                            alt={part.filename ?? "Uploaded image"}
                            className="h-auto w-full rounded-md border border-border object-contain shadow-sm"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
                {nonImageParts.map(({ part, index }) => {
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
                      return null;
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
                  className="shrink-0 w-8 h-8 rounded-full"
                />
              ) : (
                <div className="shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                  <User className="w-4 h-4 text-accent-foreground" />
                </div>
              )
            )}
          </div>
        </div>
      </div>
      {isMounted && expandedImageUrl && createPortal(
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpandedImageUrl(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              setExpandedImageUrl(null);
            }
          }}
          className="fixed inset-0 z-9999 flex items-center justify-center bg-black p-4 cursor-zoom-out"
          aria-label="Close image preview"
        >
          <img
            src={expandedImageUrl}
            alt="Expanded uploaded image"
            className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          />
        </div>,
        document.body,
      )}
    </>
  );
}
