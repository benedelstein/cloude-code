import { z } from "zod";

export const FcmTokenPlatform = z.enum(["ios"]);
export type FcmTokenPlatform = z.infer<typeof FcmTokenPlatform>;

export const RegisterFcmTokenRequest = z.object({
  deviceId: z.string().trim().min(1).max(128),
  token: z.string().trim().min(1).max(4096),
  platform: FcmTokenPlatform,
});
export type RegisterFcmTokenRequest = z.infer<typeof RegisterFcmTokenRequest>;

export const RegisterFcmTokenResponse = z.object({
  registered: z.literal(true),
});
export type RegisterFcmTokenResponse = z.infer<typeof RegisterFcmTokenResponse>;

export const NotificationType = z.enum(["TURN_FINISHED"]);
export type NotificationType = z.infer<typeof NotificationType>;

export const TurnFinishedNotificationPayload = z.object({
  type: z.literal("TURN_FINISHED"),
  version: z.literal(1),
  sessionId: z.uuid(),
  messageId: z.string().min(1),
  repoFullName: z.string().min(1),
});
export type TurnFinishedNotificationPayload = z.infer<typeof TurnFinishedNotificationPayload>;

export const NotificationPayload = z.discriminatedUnion("type", [
  TurnFinishedNotificationPayload,
]);
export type NotificationPayload = z.infer<typeof NotificationPayload>;
