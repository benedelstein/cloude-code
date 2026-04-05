import { z } from "zod";
import { SessionStatus, AgentMode, AgentSettingsInput, SessionSummary } from "../session";

/** Minimal session info returned by API */
export const SessionInfoResponse = z.object({
  sessionId: z.uuid(),
  status: SessionStatus,
  repoFullName: z.string(),
  baseBranch: z.string().optional(),
  pushedBranch: z.string().optional(),
  pullRequestUrl: z.string().optional(),
  pullRequestNumber: z.number().optional(),
  pullRequestState: z.enum(["open", "merged", "closed"]).optional(),
  editorUrl: z.string().optional(),
});
export type SessionInfoResponse = z.infer<typeof SessionInfoResponse>;

export const SessionPlanResponse = z.object({
  plan: z.string(),
  updatedAt: z.iso.datetime(),
  sourceMessageId: z.string().nullable(),
});
export type SessionPlanResponse = z.infer<typeof SessionPlanResponse>;

export const CreateSessionRequest = z.object({
  /** Numeric GitHub repo ID */
  repoId: z.number().describe("Numeric GitHub repo ID"),
  settings: AgentSettingsInput.optional().describe("Agent provider settings"),
  agentMode: AgentMode.optional().describe("Agent operational mode"),
  branch: z.string().min(1).optional().describe("Optional branch to base the session on (defaults to repo's default branch)"),
  initialMessage: z.string().min(1).optional().describe("Optional first message to send immediately after session creation"),
  attachmentIds: z.array(z.uuid()).max(20).optional().describe("Optional uploaded attachment IDs to bind to this session on create"),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const CreateSessionResponse = z.object({
  sessionId: z.uuid(),
  title: z.string().nullable(),
  websocketToken: z.string(),
  websocketTokenExpiresAt: z.iso.datetime(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

export const SessionWebSocketTokenResponse = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});
export type SessionWebSocketTokenResponse = z.infer<
  typeof SessionWebSocketTokenResponse
>;

export const UpdateSessionTitleRequest = z.object({
  title: z.string().trim().min(1).max(60),
});
export type UpdateSessionTitleRequest = z.infer<typeof UpdateSessionTitleRequest>;

export const UpdateSessionTitleResponse = z.object({
  title: z.string(),
});
export type UpdateSessionTitleResponse = z.infer<typeof UpdateSessionTitleResponse>;

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

export const ArchiveSessionResponse = z.object({
  archived: z.literal(true),
});
export type ArchiveSessionResponse = z.infer<typeof ArchiveSessionResponse>;

export const EditorOpenResponse = z.object({
  url: z.string(),
  token: z.string(),
});
export type EditorOpenResponse = z.infer<typeof EditorOpenResponse>;

export const EditorCloseResponse = z.object({
  closed: z.literal(true),
});
export type EditorCloseResponse = z.infer<typeof EditorCloseResponse>;
