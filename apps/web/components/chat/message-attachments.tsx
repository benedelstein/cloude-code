"use client";

import clsx from "clsx";

export type ImageFilePart = { type: "file"; url: string; mediaType?: string; filename?: string };

export function isImageFilePart(part: unknown): part is ImageFilePart {
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

export function AttachmentPreviewRow({
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
