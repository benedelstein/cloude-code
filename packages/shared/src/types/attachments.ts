import { z } from "zod";

export const MessageAttachmentRef = z.object({
  attachmentId: z.uuid(),
});
export type MessageAttachmentRef = z.infer<typeof MessageAttachmentRef>;

export const AttachmentDescriptor = z.object({
  attachmentId: z.uuid(),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
  sessionId: z.uuid().nullable().optional().describe("The session ID the attachment belongs to, if any. Once attached to a session, it cannot be attached to another."),
  contentUrl: z.string().min(1).describe("The URL to the attachment content. This is the URL that the client should use to display the attachment."),
});
export type AttachmentDescriptor = z.infer<typeof AttachmentDescriptor>;

export const UploadAttachmentResponse = z.object({
  attachments: z.array(AttachmentDescriptor).min(1),
});
export type UploadAttachmentResponse = z.infer<typeof UploadAttachmentResponse>;
