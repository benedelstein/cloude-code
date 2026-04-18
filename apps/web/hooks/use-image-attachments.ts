"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AttachmentDescriptor } from "@repo/shared";
import { toast } from "sonner";

export const DEFAULT_MAX_ATTACHMENTS = 20;
export const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface PendingImageAttachment {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "uploaded" | "error";
  descriptor?: AttachmentDescriptor;
  error?: string;
}

interface UseImageAttachmentsOptions {
  uploadFile: (file: File) => Promise<AttachmentDescriptor>;
  deleteAttachment?: (attachmentId: string) => Promise<void>;
  maxAttachments?: number;
  maxAttachmentBytes?: number;
}

export function useImageAttachments({
  uploadFile,
  deleteAttachment,
  maxAttachments = DEFAULT_MAX_ATTACHMENTS,
  maxAttachmentBytes = DEFAULT_MAX_ATTACHMENT_BYTES,
}: UseImageAttachmentsOptions) {
  const [attachments, setAttachments] = useState<PendingImageAttachment[]>([]);
  const attachmentsRef = useRef<PendingImageAttachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const clearAttachments = useCallback(() => {
    for (const attachment of attachmentsRef.current) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    attachmentsRef.current = [];
    setAttachments([]);
  }, []);

  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const nextAttachments: PendingImageAttachment[] = [];
    let oversizedFileName: string | null = null;
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        continue;
      }
      if (file.size > maxAttachmentBytes) {
        oversizedFileName = file.name;
        continue;
      }
      nextAttachments.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
      });
    }

    if (oversizedFileName) {
      toast.error(`"${oversizedFileName}" exceeds 10MB upload limit`);
    }

    if (nextAttachments.length === 0) {
      return;
    }

    const currentAttachments = attachmentsRef.current;
    const remainingSlots = Math.max(0, maxAttachments - currentAttachments.length);
    const acceptedAttachments = nextAttachments.slice(0, remainingSlots);
    const overflowAttachments = nextAttachments.slice(remainingSlots);
    if (overflowAttachments.length > 0) {
      toast.error(`You can attach up to ${maxAttachments} images`);
      for (const attachment of overflowAttachments) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    }
    if (acceptedAttachments.length === 0) {
      return;
    }

    const updatedAttachments = [...currentAttachments, ...acceptedAttachments];
    attachmentsRef.current = updatedAttachments;
    setAttachments(updatedAttachments);

    for (const attachment of acceptedAttachments) {
      void uploadFile(attachment.file)
        .then((descriptor) => {
          const currentAttachments = attachmentsRef.current;
          const targetIndex = currentAttachments.findIndex((candidate) => candidate.id === attachment.id);
          if (targetIndex === -1) {
            if (deleteAttachment) {
              void deleteAttachment(descriptor.attachmentId).catch(() => {
                toast.error("Failed to clean up removed attachment");
              });
            }
            return;
          }

          const updatedAttachments = [...currentAttachments];
          updatedAttachments[targetIndex] = {
            ...updatedAttachments[targetIndex],
            status: "uploaded",
            descriptor,
            error: undefined,
          };
          attachmentsRef.current = updatedAttachments;
          setAttachments(updatedAttachments);
        })
        .catch((uploadError) => {
          const message = uploadError instanceof Error
            ? uploadError.message
            : "Failed to upload attachment";
          const currentAttachments = attachmentsRef.current;
          const targetIndex = currentAttachments.findIndex((candidate) => candidate.id === attachment.id);
          if (targetIndex === -1) {
            return;
          }
          const updatedAttachments = [...currentAttachments];
          updatedAttachments[targetIndex] = {
            ...updatedAttachments[targetIndex],
            status: "error",
            error: message,
          };
          attachmentsRef.current = updatedAttachments;
          setAttachments(updatedAttachments);
        });
    }
  }, [deleteAttachment, maxAttachmentBytes, maxAttachments, uploadFile]);

  const removeAttachment = useCallback((attachmentId: string) => {
    const currentAttachments = attachmentsRef.current;
    const index = currentAttachments.findIndex((item) => item.id === attachmentId);
    if (index === -1) {
      return;
    }
    const attachment = currentAttachments[index];
    const updatedAttachments = currentAttachments.filter((item) => item.id !== attachmentId);
    attachmentsRef.current = updatedAttachments;
    setAttachments(updatedAttachments);

    if (
      deleteAttachment &&
      attachment.status === "uploaded" &&
      attachment.descriptor
    ) {
      void deleteAttachment(attachment.descriptor.attachmentId)
        .then(() => {
          URL.revokeObjectURL(attachment.previewUrl);
        })
        .catch(() => {
          toast.error("Failed to delete attachment.");
          setAttachments((current) => {
            if (current.some((candidate) => candidate.id === attachment.id)) {
              return current;
            }
            const restored = [...current];
            const restoreIndex = Math.min(index, restored.length);
            restored.splice(restoreIndex, 0, attachment);
            attachmentsRef.current = restored;
            return restored;
          });
        });
      return;
    }

    URL.revokeObjectURL(attachment.previewUrl);
  }, [deleteAttachment]);

  const uploadedDescriptors = useMemo(
    () =>
      attachments
        .map((attachment) => attachment.descriptor)
        .filter((descriptor): descriptor is AttachmentDescriptor => descriptor !== undefined),
    [attachments],
  );

  const isUploading = attachments.some((attachment) => attachment.status === "uploading");
  const hasPendingOrFailedUploads = attachments.some((attachment) => attachment.status !== "uploaded");

  return {
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    uploadedDescriptors,
    isUploading,
    hasPendingOrFailedUploads,
  };
}
