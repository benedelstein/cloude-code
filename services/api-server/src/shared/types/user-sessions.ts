import { z } from "zod";

export const UserSessionsPublishMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.summary.invalidate"),
    sessionId: z.uuid(),
  }),
  z.object({
    type: z.literal("session.summary.remove"),
    sessionId: z.uuid(),
  }),
  z.object({
    type: z.literal("session.list.resync_required"),
  }),
]);
export type UserSessionsPublishMessage = z.infer<typeof UserSessionsPublishMessage>;
