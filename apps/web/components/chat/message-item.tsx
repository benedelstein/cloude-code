"use client";

import { useEffect, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import type { DynamicToolUIPart } from "ai";
import { isTextUIPart, isReasoningUIPart, isToolUIPart } from "ai";
import { Check, ChevronRight, Copy, User } from "lucide-react";
import clsx from "clsx";
import { createPortal } from "react-dom";
import {
  isProviderTodoToolName,
  normalizeToolPart,
  type NormalizedToolAction,
  type ProviderId,
} from "@repo/shared";
import { TextPart } from "@/components/parts/text-part";
import { ExitPlanModePart } from "@/components/parts/exit-plan-mode-part";
import { BashPart } from "@/components/parts/bash-part";
import { ReasoningPart } from "@/components/parts/reasoning-part";
import { TodoToolPart } from "@/components/parts/todo-write-part";
import { ReadPart } from "@/components/parts/read-part";
import { EditPart } from "@/components/parts/edit-part";
import { WritePart } from "@/components/parts/write-part";
import { SearchPart } from "@/components/parts/search-part";
import { WebPart } from "@/components/parts/web-part";
import { GenericToolPart } from "@/components/parts/generic-tool-part";
import { GroupedToolPart } from "@/components/parts/grouped-tool-part";
import { groupActions, type ActionItem } from "@/components/parts/group-actions";
import { humanizeDuration } from "@/lib/duration";
import { useNow } from "@/lib/use-now";

interface MessageItemProps {
  message: UIMessage;
  isStreaming?: boolean;
  userAvatarUrl?: string | null;
  providerId?: ProviderId | null;
}

type ImageFilePart = { type: "file"; url: string; mediaType?: string; filename?: string };

function isImageFilePart(part: unknown): part is ImageFilePart {
  if (!part || typeof part !== "object") return false;
  const candidate = part as { type?: unknown; url?: unknown; mediaType?: unknown };
  return candidate.type === "file"
    && typeof candidate.url === "string"
    && (typeof candidate.mediaType === "string" ? candidate.mediaType.startsWith("image/") : true);
}

function resolveAttachmentUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (url.startsWith("/api/")) return url;
  if (url.startsWith("/")) return `/api${url}`;
  return `/api/${url}`;
}

type RenderItem =
  | { kind: "text"; key: string; text: string }
  | { kind: "reasoning"; key: string; part: { text?: string; startedAt?: number; endedAt?: number } }
  | { kind: "todo"; key: string; part: DynamicToolUIPart }
  | { kind: "plan"; key: string; part: DynamicToolUIPart }
  | { kind: "action-item"; key: string; item: ActionItem };

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

    parts.forEach((part, index) => {
      if (isImageFilePart(part)) return;
      if (!part || typeof part !== "object" || !("type" in part)) return;
      if (part.type === "step-start") return;

      if (isTextUIPart(part)) {
        flushActions();
        items.push({
          kind: "text",
          key: `${message.id}-text-${index}`,
          text: part.text,
        });
        return;
      }

      if (isReasoningUIPart(part)) {
        flushActions();
        items.push({
          kind: "reasoning",
          key: `${message.id}-reasoning-${index}`,
          part: part as { text?: string; startedAt?: number; endedAt?: number },
        });
        return;
      }

      if (isToolUIPart(part) || (typeof part.type === "string" && part.type.startsWith("tool-"))) {
        const toolPart = part as DynamicToolUIPart;
        const toolName = (toolPart as { toolName?: string }).toolName
          ?? toolPart.type.replace(/^tool-/, "");
        if (isProviderTodoToolName(toolName)) {
          flushActions();
          items.push({ kind: "todo", key: `${message.id}-todo-${index}`, part: toolPart });
          return;
        }
        if (toolName === "ExitPlanMode") {
          flushActions();
          items.push({ kind: "plan", key: `${message.id}-plan-${index}`, part: toolPart });
          return;
        }
        if (!providerId) {
          pendingActionItems = pendingActionItems ?? { keyBase: `${message.id}-actions-${index}`, actions: [] };
          pendingActionItems.actions.push({
            kind: "other",
            toolName,
            toolCallId: toolPart.toolCallId,
            state: toolPart.state,
            payload: {
              toolName,
              input: (toolPart as { input?: unknown }).input,
              output: (toolPart as { output?: unknown }).output,
            },
          });
          return;
        }
        const actions = normalizeToolPart(toolPart, providerId);
        pendingActionItems = pendingActionItems ?? { keyBase: `${message.id}-actions-${index}`, actions: [] };
        pendingActionItems.actions.push(...actions);
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
  // Collapse everything before the LAST text item when settled. Final text
  // stays visible; earlier text and all work parts hide behind the header.
  const collapsedPrefixLength = (() => {
    if (!isSettled || isAborted || !hasFinalText) return 0;
    let lastTextIndex = -1;
    for (let i = renderItems.length - 1; i >= 0; i--) {
      if (renderItems[i]!.kind === "text") {
        lastTextIndex = i;
        break;
      }
    }
    return lastTextIndex > 0 ? lastTextIndex : 0;
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

function formatMessageTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function AttachmentPreviewRow({
  imageParts,
  messageId,
  alignRight,
  onExpand,
}: {
  imageParts: Array<{ part: ImageFilePart; index: number }>;
  messageId: string;
  alignRight: boolean;
  onExpand: (url: string) => void;
}) {
  if (imageParts.length === 0) return null;

  return (
    <div
      className={clsx(
        "mb-1 flex items-end gap-2 overflow-x-auto pb-0.5",
        alignRight ? "justify-end" : "justify-start",
      )}
    >
      {imageParts.map(({ part, index }) => {
        const imageUrl = resolveAttachmentUrl(part.url);
        return (
          <button
            key={`${messageId}-image-${index}`}
            type="button"
            onClick={() => onExpand(imageUrl)}
            className="block w-32 shrink-0 cursor-zoom-in"
            aria-label="Open image preview"
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
  );
}

function MessageHoverActions({
  isUser,
  createdAt,
  canCopy,
  copied,
  onCopy,
}: {
  isUser: boolean;
  createdAt: Date | null;
  canCopy: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  if (!createdAt && !canCopy) return null;

  return (
    <div
      className={clsx(
        "mt-1 flex items-center gap-2 text-xs text-foreground-tertiary opacity-0 transition-opacity group-hover/message:opacity-100",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {createdAt && <span>{formatMessageTime(createdAt)}</span>}
      {canCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm hover:bg-muted hover:text-foreground-muted"
          title={copied ? "Copied" : "Copy message"}
          aria-label={copied ? "Message copied" : "Copy message"}
        >
          {copied
            ? <Check className="h-3.5 w-3.5" />
            : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

interface TurnWorkHeaderProps {
  expanded: boolean;
  onToggle: () => void;
  startedAt: number | undefined;
  endedAt: number | undefined;
  isStreaming: boolean;
}

function TurnWorkHeader({ expanded, onToggle, startedAt, endedAt, isStreaming }: TurnWorkHeaderProps) {
  const tickIntervalMs = isStreaming && startedAt !== undefined && endedAt === undefined
    ? 1000
    : 60_000;
  const now = useNow(tickIntervalMs);

  let label = "Worked";
  if (startedAt !== undefined && endedAt !== undefined) {
    label = `Worked for ${humanizeDuration(endedAt - startedAt)}`;
  } else if (startedAt !== undefined && isStreaming) {
    label = `Working for ${humanizeDuration(now - startedAt)}`;
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-fit items-center gap-2 py-1 text-[13px] text-foreground-muted hover:text-foreground transition-colors text-left rounded cursor-pointer"
      aria-expanded={expanded}
    >
      <span>{label}</span>
      <ChevronRight className={clsx("w-3.5 h-3.5 transition-transform", expanded ? "rotate-90" : "hidden group-hover:block")} />
    </button>
  );
}

function WorkItems({ items, isStreaming, isUser }: { items: RenderItem[]; isStreaming: boolean; isUser: boolean }) {
  return (
    <>
      {items.map((item, index) => {
        const previous = items[index - 1];
        const isToolItem = item.kind === "action-item" || item.kind === "todo" || item.kind === "plan";
        const previousIsToolItem = previous?.kind === "action-item" || previous?.kind === "todo" || previous?.kind === "plan";
        const needsBoundarySpacing = (item.kind === "text" && previousIsToolItem)
          || (isToolItem && previous?.kind === "text");

        return (
          <div key={item.key} className={clsx(needsBoundarySpacing && "mt-4")}>
            <WorkItemRenderer item={item} isStreaming={isStreaming} isUser={isUser} />
          </div>
        );
      })}
    </>
  );
}

function WorkItemRenderer({ item, isStreaming, isUser }: { item: RenderItem; isStreaming: boolean; isUser: boolean }) {
  switch (item.kind) {
    case "text":
      return <TextPart text={item.text} isUser={isUser} />;
    case "reasoning":
      return <ReasoningPart part={item.part} isStreaming={isStreaming} />;
    case "todo":
      return <TodoToolPart part={item.part as unknown as Parameters<typeof TodoToolPart>[0]["part"]} />;
    case "plan":
      return <ExitPlanModePart part={item.part as unknown as Parameters<typeof ExitPlanModePart>[0]["part"]} />;
    case "action-item":
      return <ActionItemRenderer item={item.item} />;
    default: {
      const exhaustive: never = item;
      throw new Error(`Unhandled work item: ${(exhaustive as { kind: string }).kind}`);
    }
  }
}

function ActionItemRenderer({ item }: { item: ActionItem }) {
  if (item.type === "group") {
    return <GroupedToolPart group={item} />;
  }
  const { action } = item;
  switch (action.kind) {
    case "read":
      return <ReadPart action={action.payload} />;
    case "edit":
      return <EditPart action={action.payload} />;
    case "write":
      return <WritePart action={action.payload} />;
    case "bash":
      return <BashPart action={action.payload} />;
    case "search":
      return <SearchPart action={action.payload} />;
    case "web":
      return <WebPart action={action.payload} />;
    case "other":
      return <GenericToolPart action={action.payload} />;
    case "todo":
    case "plan":
      // todo/plan are extracted upstream; this branch is unreachable in practice.
      return null;
    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled action kind: ${(exhaustive as { kind: string }).kind}`);
    }
  }
}
