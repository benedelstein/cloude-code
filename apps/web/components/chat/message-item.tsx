"use client";

import { useEffect, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { getToolName } from "ai";
import { isTextUIPart, isToolUIPart } from "ai";
import { User } from "lucide-react";
import clsx from "clsx";
import { createPortal } from "react-dom";
import {
  normalizeToolPart,
  type NormalizedToolAction,
  type ProviderId,
} from "@repo/shared";
import { groupActions } from "@/components/parts/group-actions";
import {
  AttachmentPreviewRow,
  isImageFilePart,
} from "@/components/chat/message-attachments";
import { MessageHoverActions } from "@/components/chat/message-hover-actions";
import { TurnWorkHeader } from "@/components/chat/message-turn-work-header";
import { WorkItems, type RenderItem } from "@/components/chat/message-work-items";

interface MessageItemProps {
  message: UIMessage;
  isStreaming?: boolean;
  userAvatarUrl?: string | null;
  providerId?: ProviderId | null;
}

export function MessageItem({ message, isStreaming, userAvatarUrl, providerId }: MessageItemProps) {
  const isUser = message.role === "user";
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  const isAborted = !isUser && metadata.aborted === true;
  const [expandedImageUrl, setExpandedImageUrl] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [workExpanded, setWorkExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!expandedImageUrl) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedImageUrl(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expandedImageUrl]);

  const parts = message.parts ?? [];
  const imageParts = useMemo(
    () => parts.flatMap((part, index) => (isImageFilePart(part) ? [{ part, index }] : [])),
    [parts],
  );

  // Build a single ordered list of items mirroring the parts array, so render
  // order matches arrival order. Adjacent tool parts are still grouped via
  // groupActions, but never reordered relative to text or reasoning.
  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    let pendingActionItems: { keyBase: string; actions: NormalizedToolAction[] } | null = null;

    const flushActions = () => {
      if (!pendingActionItems || pendingActionItems.actions.length === 0) {
        pendingActionItems = null;
        return;
      }
      const grouped = groupActions(pendingActionItems.actions);
      grouped.forEach((item, index) => {
        items.push({
          kind: "action-item",
          key: `${pendingActionItems!.keyBase}-${index}-${item.key}`,
          item,
        });
      });
      pendingActionItems = null;
    };

    const appendToolActions = (part: Parameters<typeof normalizeToolPart>[0], index: number) => {
      const toolName = getToolName(part);
      if (!providerId) {
        pendingActionItems = pendingActionItems ?? { keyBase: `${message.id}-actions-${index}`, actions: [] };
        pendingActionItems.actions.push({
          kind: "other",
          toolName,
          toolCallId: part.toolCallId,
          state: part.state,
          payload: {
            toolName,
            input: (part as { input?: unknown }).input,
            output: (part as { output?: unknown }).output,
          },
        });
        return;
      }
      const actions = normalizeToolPart(part, providerId);
      pendingActionItems = pendingActionItems ?? { keyBase: `${message.id}-actions-${index}`, actions: [] };
      pendingActionItems.actions.push(...actions);
    };

    parts.forEach((part, index) => {
      if (!part || typeof part !== "object" || !("type" in part)) return;

      switch (part.type) {
        case "text":
          flushActions();
          items.push({
            kind: "text",
            key: `${message.id}-text-${index}`,
            text: part.text,
          });
          return;

        case "reasoning":
          flushActions();
          items.push({
            kind: "reasoning",
            key: `${message.id}-reasoning-${index}`,
            part: part as { text?: string; startedAt?: number; endedAt?: number },
          });
          return;

        case "dynamic-tool":
          appendToolActions(part, index);
          return;

        case "file":
          if (isImageFilePart(part)) {
            // Image files render through AttachmentPreviewRow outside renderItems.
            return;
          }
          // Non-image files are preserved in the message but do not have a chat
          // renderer yet. Keep them as an explicit boundary for tool grouping.
          flushActions();
          return;

        case "source-url":
        case "source-document":
          // Source citations are preserved in storage; this chat surface does
          // not render citation rows yet.
          flushActions();
          return;

        case "step-start":
          return;

        default:
          if (isToolUIPart(part)) {
            appendToolActions(part, index);
            return;
          }
          if (typeof part.type === "string" && part.type.startsWith("data-")) {
            // App-defined data parts need per-type renderers before they can be
            // shown meaningfully. Avoid dropping pending tool grouping across
            // them.
            flushActions();
            return;
          }
          return;
        }
    });

    flushActions();
    return items;
  }, [parts, providerId, message.id]);

  const hasFinalText = parts.some(
    (part) => isTextUIPart(part) && (part as { state?: string }).state !== "streaming",
  );
  const isSettled = !isStreaming;
  // Collapse work before the LAST text item when settled. Final text stays
  // visible; earlier text only collapses when mixed with actual work items.
  const collapsedPrefixLength = (() => {
    if (!isSettled || isAborted || !hasFinalText) return 0;
    let lastTextIndex = -1;
    for (let i = renderItems.length - 1; i >= 0; i--) {
      if (renderItems[i]!.kind === "text") {
        lastTextIndex = i;
        break;
      }
    }
    if (lastTextIndex <= 0) return 0;

    const hasWorkBeforeFinalText = renderItems
      .slice(0, lastTextIndex)
      .some((item) => item.kind !== "text");

    return hasWorkBeforeFinalText ? lastTextIndex : 0;
  })();
  const showCollapsedTurn = collapsedPrefixLength > 0;

  const startedAt = typeof metadata.startedAt === "number" ? metadata.startedAt : undefined;
  const endedAt = typeof metadata.endedAt === "number" ? metadata.endedAt : undefined;
  const createdAt = messageCreatedAt(message);
  const copyText = getMessageText(message);
  const copyMessageText = async () => {
    if (!copyText || !navigator.clipboard) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const userImageParts = isUser ? imageParts : [];
  const bubbleImageParts = isUser ? [] : imageParts;
  const hasBubbleContent = !isUser || bubbleImageParts.length > 0 || renderItems.length > 0;

  return (
    <>
      <div className={clsx("group/message flex", isUser ? "justify-end" : "justify-start")}>
        <div className={clsx("order-1", isUser ? "max-w-[85%]" : "w-[85%]")}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <AttachmentPreviewRow
                imageParts={userImageParts}
                messageId={message.id}
                alignRight={isUser}
                onExpand={setExpandedImageUrl}
              />
              {hasBubbleContent && (
                <div
                  className={clsx(
                    "rounded-md min-w-0 overflow-hidden",
                    isUser && "px-3 py-2 bg-accent-subtle text-accent-foreground",
                  )}
                >
                  <AttachmentPreviewRow
                    imageParts={bubbleImageParts}
                    messageId={message.id}
                    alignRight={isUser}
                    onExpand={setExpandedImageUrl}
                  />

                  {!isUser && showCollapsedTurn && (
                    <>
                      <TurnWorkHeader
                        expanded={workExpanded}
                        onToggle={() => setWorkExpanded((v) => !v)}
                        startedAt={startedAt}
                        endedAt={endedAt}
                        isStreaming={false}
                      />
                      <div
                        className={clsx(
                          "grid transition-[grid-template-rows] duration-200 ease-out",
                          workExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                        )}
                      >
                        <div className="overflow-hidden min-h-0">
                          <div className="space-y-0.5 mb-4">
                            <WorkItems
                              items={renderItems.slice(0, collapsedPrefixLength)}
                              isStreaming={!!isStreaming}
                              isUser={isUser}
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <WorkItems
                    items={renderItems.slice(collapsedPrefixLength)}
                    isStreaming={!!isStreaming}
                    isUser={isUser}
                  />
                </div>
              )}

              {isAborted && (
                <p className="mt-1.5 text-xs text-foreground-muted italic">Interrupted</p>
              )}
              <MessageHoverActions
                isUser={isUser}
                createdAt={createdAt}
                canCopy={copyText.length > 0}
                copied={copied}
                onCopy={() => void copyMessageText()}
              />
            </div>

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
            if (event.key === "Enter" || event.key === " ") setExpandedImageUrl(null);
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

function messageCreatedAt(message: UIMessage): Date | null {
  const metadata = message.metadata && typeof message.metadata === "object"
    ? message.metadata as Record<string, unknown>
    : {};
  const rawCreatedAt = metadata.createdAt;
  if (typeof rawCreatedAt === "string") {
    const date = new Date(rawCreatedAt);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const rawStartedAt = metadata.startedAt;
  if (typeof rawStartedAt === "number") {
    const date = new Date(rawStartedAt);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
}
