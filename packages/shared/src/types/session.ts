import { z } from "zod";

export const SessionStatus = z.enum([
  /** Provisioning the session */
  "provisioning",
  /** Cloning the repository */
  "cloning",
  /** Syncing the repository via git */
  "syncing",
  /** Attaching to the agent process running on the vm */
  "attaching",
  /** Waking up the vm */
  "waking",
  /** Hibernating the vm */
  "hibernating",
  /** Error occurred */
  "error",
  /** Session is terminated. No more messages can be sent or received. */
  "terminated",
  /** Ready to send and receive messages */
  "ready",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionSettings = z.object({
  model: z.string().default("claude-opus-4-20250514"),
  maxTokens: z.number().default(8192),
});
export type SessionSettings = z.infer<typeof SessionSettings>;

/** Minimal session info returned by API */
export const SessionInfoResponse = z.object({
  sessionId: z.uuid(),
  status: SessionStatus,
  repoId: z.string(),
  pushedBranch: z.string().optional(),
  pullRequestUrl: z.string().optional(),
  pullRequestNumber: z.number().optional(),
  pullRequestState: z.enum(["open", "merged", "closed"]).optional(),
});
export type SessionInfoResponse = z.infer<typeof SessionInfoResponse>;

export const CreateSessionRequest = z.object({
  repoId: z.string().min(1),
  settings: SessionSettings.partial().optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const CreateSessionResponse = z.object({
  sessionId: z.string().uuid(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

export const Message = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  toolCalls: z.array(z.unknown()).optional(),
  streamPosition: z.number().optional(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof Message>;

export const ToolCall = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
  output: z.string().nullable(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  createdAt: z.iso.datetime(),
});
export type ToolCall = z.infer<typeof ToolCall>;

/** Summary of a session for the session list */
export const SessionSummary = z.object({
  id: z.string().uuid(),
  repoId: z.string(),
  title: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** Paginated response for GET /sessions */
export const ListSessionsResponse = z.object({
  sessions: z.array(SessionSummary),
  cursor: z.string().nullable(),
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponse>;

export const SpriteCheckpoint = z.object({
  id: z.string(),
  sessionId: z.uuid(),
  version: z.number(),
  gitCommitSha: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type SpriteCheckpoint = z.infer<typeof SpriteCheckpoint>;
