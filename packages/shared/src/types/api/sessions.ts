import { z } from "zod";
import { SessionStatus, SessionSettings, SessionSummary } from "../session";

/** Minimal session info returned by API */
export const SessionInfoResponse = z.object({
  sessionId: z.uuid(),
  status: SessionStatus,
  repoFullName: z.string(),
  pushedBranch: z.string().optional(),
  pullRequestUrl: z.string().optional(),
  pullRequestNumber: z.number().optional(),
  pullRequestState: z.enum(["open", "merged", "closed"]).optional(),
  editorUrl: z.string().optional(),
});
export type SessionInfoResponse = z.infer<typeof SessionInfoResponse>;

export const CreateSessionRequest = z.object({
  /** Numeric GitHub repo ID (stable across renames) */
  repoId: z.number(),
  /** "owner/repo" full name */
  repoFullName: z.string().min(1),
  settings: SessionSettings.partial().optional(),
  /** Optional first message to send immediately after session creation */
  initialMessage: z.string().min(1).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const CreateSessionResponse = z.object({
  sessionId: z.uuid(),
  title: z.string().nullable(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

/** Paginated response for GET /sessions */
export const ListSessionsResponse = z.object({
  sessions: z.array(SessionSummary),
  cursor: z.string().nullable(),
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponse>;

export const PullRequestResponse = z.object({
  url: z.string(),
  number: z.number(),
  state: z.string(),
});
export type PullRequestResponse = z.infer<typeof PullRequestResponse>;

export const PullRequestStatusResponse = z.object({
  url: z.string(),
  number: z.number(),
  state: z.string(),
  merged: z.boolean(),
});
export type PullRequestStatusResponse = z.infer<
  typeof PullRequestStatusResponse
>;

export const DeleteSessionResponse = z.object({
  deleted: z.literal(true),
});
export type DeleteSessionResponse = z.infer<typeof DeleteSessionResponse>;
