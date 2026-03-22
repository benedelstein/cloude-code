import { z } from "zod/v4";
import type { UIMessage, UIMessagePart } from "ai";
import { SessionStatus } from "./session";
import { MessageAttachmentRef } from "./attachments";

// Re-export AI SDK types for convenience
export type { UIMessage, UIMessagePart };

// ------------------------------------------------------------
// Client → Server messages
// ------------------------------------------------------------
export const ChatMessageEvent = z.object({
  type: z.literal("chat.message"),
  content: z.string().trim().min(1).optional(),
  attachments: z.array(MessageAttachmentRef).max(20).optional(),
  messageId: z.uuid().optional(),
  /** If provided, switch to this model before processing the message. */
  model: z.string().optional(),
}).refine(
  (value) => Boolean(value.content) || (value.attachments?.length ?? 0) > 0,
  "chat.message must include content or attachments",
);
export type ChatMessageEvent = z.infer<typeof ChatMessageEvent>;

export const SyncRequestEvent = z.object({
  type: z.literal("sync.request"),
  lastMessageId: z.uuid().optional(),
  lastChunkIndex: z.number().optional(),
});
export type SyncRequestEvent = z.infer<typeof SyncRequestEvent>;

export const OperationCancelEvent = z.object({
  type: z.literal("operation.cancel"),
});
export type OperationCancelEvent = z.infer<typeof OperationCancelEvent>;

export const ClientMessage = z.discriminatedUnion("type", [
  ChatMessageEvent,
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
  lastMessageId: z.uuid().optional(),
});
export type ConnectedEvent = z.infer<typeof ConnectedEvent>;

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

export const OperationErrorCode = z.enum([
  "INVALID_MESSAGE",
  "MESSAGE_HANDLER_ERROR",
  "CHAT_MESSAGE_FAILED",
]);
export type OperationErrorCode = z.infer<typeof OperationErrorCode>;

export const OperationErrorEvent = z.object({
  type: z.literal("operation.error"),
  code: OperationErrorCode,
  message: z.string(),
});
export type OperationErrorEvent = z.infer<typeof OperationErrorEvent>;

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

export const EditorReadyEvent = z.object({
  type: z.literal("editor.ready"),
  url: z.string(),
  token: z.string(),
});
export type EditorReadyEvent = z.infer<typeof EditorReadyEvent>;

export const ServerMessage = z.discriminatedUnion("type", [
  ConnectedEvent,
  SyncResponseEvent,
  OperationErrorEvent,
  AgentChunkEvent,
  AgentFinishEvent,
  AgentReadyEvent,
  UserMessageEvent,
  BranchPushedEvent,
  EditorReadyEvent,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
