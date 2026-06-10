import { z } from "zod";
import { SessionSummary } from "../session";

export const UserSessionsConnectedEvent = z.object({
  type: z.literal("user_sessions.connected"),
});
export type UserSessionsConnectedEvent = z.infer<typeof UserSessionsConnectedEvent>;

export const SessionSummaryUpdatedEvent = z.object({
  type: z.literal("session.summary.updated"),
  session: SessionSummary,
});
export type SessionSummaryUpdatedEvent = z.infer<typeof SessionSummaryUpdatedEvent>;

export const SessionSummaryCreatedEvent = z.object({
  type: z.literal("session.summary.created"),
  session: SessionSummary,
});
export type SessionSummaryCreatedEvent = z.infer<typeof SessionSummaryCreatedEvent>;

export const SessionSummaryRemovedEvent = z.object({
  type: z.literal("session.summary.removed"),
  sessionId: z.uuid(),
});
export type SessionSummaryRemovedEvent = z.infer<typeof SessionSummaryRemovedEvent>;

export const SessionListResyncRequiredEvent = z.object({
  type: z.literal("session.list.resync_required"),
});
export type SessionListResyncRequiredEvent = z.infer<typeof SessionListResyncRequiredEvent>;

export const UserSessionsServerMessage = z.discriminatedUnion("type", [
  UserSessionsConnectedEvent,
  SessionSummaryCreatedEvent,
  SessionSummaryUpdatedEvent,
  SessionSummaryRemovedEvent,
  SessionListResyncRequiredEvent,
]);
export type UserSessionsServerMessage = z.infer<typeof UserSessionsServerMessage>;
