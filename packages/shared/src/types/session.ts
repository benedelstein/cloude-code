import { z } from "zod";

export const SessionStatus = z.enum([
  "creating",
  "provisioning",
  "ready",
  "hibernating",
  "error",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionSettings = z.object({
  model: z.string().default("claude-opus-4-20250514"),
  maxTokens: z.number().default(8192),
});
export type SessionSettings = z.infer<typeof SessionSettings>;

export const Session = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  repoId: z.string(),
  spriteName: z.string().nullable(),
  status: SessionStatus,
  settings: SessionSettings,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Session = z.infer<typeof Session>;

export const CreateSessionRequest = z.object({
  repoId: z.string().min(1),
  settings: SessionSettings.partial().optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const CreateSessionResponse = z.object({
  sessionId: z.string().uuid(),
  wsUrl: z.string().url(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

export const Message = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  toolCalls: z.array(z.unknown()).optional(),
  streamPosition: z.number().optional(),
  createdAt: z.string().datetime(),
});
export type Message = z.infer<typeof Message>;

export const ToolCall = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  toolName: z.string(),
  input: z.record(z.unknown()),
  output: z.string().nullable(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  createdAt: z.string().datetime(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const SpriteCheckpoint = z.object({
  id: z.string(),
  sessionId: z.string().uuid(),
  version: z.number(),
  gitCommitSha: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type SpriteCheckpoint = z.infer<typeof SpriteCheckpoint>;
