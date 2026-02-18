import { z } from "zod/v4";
import type { UIMessage, UIMessagePart } from "ai";
import { SessionStatus } from "./session";

// Re-export AI SDK types for convenience
export type { UIMessage, UIMessagePart };

// ------------------------------------------------------------
// Client → Server messages
// ------------------------------------------------------------
export const ChatMessageEvent = z.object({
  type: z.literal("chat.message"),
  content: z.string().min(1),
  messageId: z.string().uuid().optional(),
});
export type ChatMessageEvent = z.infer<typeof ChatMessageEvent>;

export const StreamAckEvent = z.object({
  type: z.literal("stream.ack"),
  messageId: z.string().uuid(),
  chunkIndex: z.number(),
});
export type StreamAckEvent = z.infer<typeof StreamAckEvent>;

export const SyncRequestEvent = z.object({
  type: z.literal("sync.request"),
  lastMessageId: z.string().uuid().optional(),
  lastChunkIndex: z.number().optional(),
});
export type SyncRequestEvent = z.infer<typeof SyncRequestEvent>;

export const OperationCancelEvent = z.object({
  type: z.literal("operation.cancel"),
});
export type OperationCancelEvent = z.infer<typeof OperationCancelEvent>;

export const ClientMessage = z.discriminatedUnion("type", [
  ChatMessageEvent,
  StreamAckEvent,
  SyncRequestEvent,
  OperationCancelEvent,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ------------------------------------------------------------
// Server → Client messages
// ------------------------------------------------------------
export const ConnectedEvent = z.object({
  type: z.literal("connected"),
  sessionId: z.uuid(),
  status: SessionStatus,
  lastMessageId: z.string().uuid().optional(),
});
export type ConnectedEvent = z.infer<typeof ConnectedEvent>;


export const SessionStatusEvent = z.object({
  type: z.literal("session.status"),
  status: SessionStatus,
  message: z.string().optional(),
});
export type SessionStatusEvent = z.infer<typeof SessionStatusEvent>;

// Zod schema for UIMessage (runtime validation)
export const UIMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.unknown()), // UIMessagePart[]
  metadata: z.unknown().optional(),
});

export const SyncResponseEvent = z.object({
  type: z.literal("sync.response"),
  messages: z.array(UIMessageSchema),
  pendingChunks: z.array(z.unknown()).optional(),
});
export type SyncResponseEvent = z.infer<typeof SyncResponseEvent>;

export const ErrorEvent = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});
export type ErrorEvent = z.infer<typeof ErrorEvent>;

// AI SDK UIMessageStream chunk (for real-time streaming)
export const AgentChunkEvent = z.object({
  type: z.literal("agent.chunk"),
  chunk: z.unknown(), // UIMessageStreamPart from AI SDK
});
export type AgentChunkEvent = z.infer<typeof AgentChunkEvent>;

// Agent message finished (accumulated UIMessage saved)
export const AgentFinishEvent = z.object({
  type: z.literal("agent.finish"),
  message: UIMessageSchema,
});
export type AgentFinishEvent = z.infer<typeof AgentFinishEvent>;

export const AgentReadyEvent = z.object({
  type: z.literal("agent.ready"),
});
export type AgentReadyEvent = z.infer<typeof AgentReadyEvent>;

export const UserMessageEvent = z.object({
  type: z.literal("user.message"),
  message: UIMessageSchema,
});
export type UserMessageEvent = z.infer<typeof UserMessageEvent>;

export const BranchPushedEvent = z.object({
  type: z.literal("branch.pushed"),
  branch: z.string(),
  repoFullName: z.string(),
});
export type BranchPushedEvent = z.infer<typeof BranchPushedEvent>;

export const ServerMessage = z.discriminatedUnion("type", [
  ConnectedEvent,
  SessionStatusEvent,
  SyncResponseEvent,
  ErrorEvent,
  AgentChunkEvent,
  AgentFinishEvent,
  AgentReadyEvent,
  UserMessageEvent,
  BranchPushedEvent,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
