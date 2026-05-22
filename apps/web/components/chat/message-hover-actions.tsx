"use client";

import { Check, Copy } from "lucide-react";
import clsx from "clsx";

function formatMessageTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function MessageHoverActions({
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
