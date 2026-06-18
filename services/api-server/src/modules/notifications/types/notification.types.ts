import type { NotificationPayload } from "@repo/api-contract";

export interface FcmToken {
  userId: string;
  deviceId: string;
  token: string;
  platform: "ios";
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface NotificationQueueMessage {
  id: string;
  toUserId: string;
  title: string;
  body: string;
  payload: NotificationPayload;
  createdAt: string;
}
