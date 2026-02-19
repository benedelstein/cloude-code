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
  id: z.uuid(),
  repoId: z.number(),
  repoFullName: z.string(),
  title: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SpriteCheckpoint = z.object({
  id: z.string(),
  sessionId: z.uuid(),
  version: z.number(),
  gitCommitSha: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type SpriteCheckpoint = z.infer<typeof SpriteCheckpoint>;
