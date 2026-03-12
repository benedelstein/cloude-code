import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import type { PendingImageAttachment } from "@/hooks/use-image-attachments";

function AttachmentThumbnail({
  attachment,
  onRemove,
}: {
  attachment: PendingImageAttachment;
  onRemove: () => void;
}) {
  return (
    <div
      className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border ${
        attachment.status === "error" ? "border-danger" : "border-border"
      }`}
    >
      <img
        src={attachment.previewUrl}
        alt={attachment.file.name}
        className={`h-full w-full object-cover ${
          attachment.status === "uploading" ? "opacity-60" : ""
        }`}
      />
      {attachment.status === "uploading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <LoadingSpinner className="h-4 w-4 text-white" />
        </div>
      )}
      {attachment.status === "error" && (
        <div className="absolute left-1 top-1 rounded bg-danger/90 px-1 text-[10px] text-white">
          Failed
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-foreground-muted hover:text-foreground"
        aria-label={`Remove ${attachment.file.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function ChatAttachmentPreviews({
  attachments,
  onRemove,
  className,
}: {
  attachments: PendingImageAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  // Keep rendering the last non-empty list during the exit animation
  // so the grid row has content to collapse smoothly.
  const lastNonEmpty = useRef<PendingImageAttachment[]>(attachments);
  useEffect(() => {
    if (attachments.length > 0) {
      lastNonEmpty.current = attachments;
    }
  }, [attachments]);

  const isVisible = attachments.length > 0;
  const displayedAttachments = isVisible ? attachments : lastNonEmpty.current;

  return (
    <div
      className="grid transition-all duration-300 ease-in-out"
      style={{
        gridTemplateRows: isVisible ? "1fr" : "0fr",
        opacity: isVisible ? 1 : 0,
      }}
    >
      <div className="overflow-hidden">
        <div className={className ?? "px-4 pt-4"}>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {displayedAttachments.map((attachment) => (
              <AttachmentThumbnail
                key={attachment.id}
                attachment={attachment}
                onRemove={() => onRemove(attachment.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
