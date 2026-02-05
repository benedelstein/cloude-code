import { z } from "zod";

export const SessionStatus = z.enum([
  "provisioning",
  "cloning",
  "syncing",
  "attaching",
  "ready",
  "waking",
  "hibernating",
  "error",
  "terminated",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionSettings = z.object({
  model: z.string().default("claude-opus-4-20250514"),
  maxTokens: z.number().default(8192),
});
export type SessionSettings = z.infer<typeof SessionSettings>;

export const Session = z.object({
  id: z.uuid(),
  userId: z.string(),
  repoId: z.string(),
  spriteName: z.string().nullable(),
  githubBranchName: z.string().nullable(),
  status: SessionStatus,
  settings: SessionSettings,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Session = z.infer<typeof Session>;

/** Minimal session info returned by API */
export const SessionInfoResponse = z.object({
  sessionId: z.uuid(),
  status: SessionStatus,
  repoId: z.string(),
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

export const SpriteCheckpoint = z.object({
  id: z.string(),
  sessionId: z.uuid(),
  version: z.number(),
  gitCommitSha: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type SpriteCheckpoint = z.infer<typeof SpriteCheckpoint>;
