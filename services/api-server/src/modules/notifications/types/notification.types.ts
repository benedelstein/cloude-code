import type { NotificationPayload } from "@repo/api-contract";

export interface FcmToken {
  userId: string;
  deviceId: string;
  token: string;
  platform: "ios";
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  invalidatedAt: string | null;
}

export interface NotificationQueueMessage {
  id: string;
  toUserId: string;
  title: string;
  body: string;
  payload: NotificationPayload;
  createdAt: string;
}

export type FcmSendResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | { code: "TERMINAL_TOKEN"; message: string; status: number }
        | { code: "TRANSIENT"; message: string; status?: number };
    };
