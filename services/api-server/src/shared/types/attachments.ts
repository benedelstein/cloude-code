export interface AttachmentRecord {
  id: string;
  uploaderUserId: string;
  objectKey: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  sessionId: string | null;
  boundAt: string | null;
}
