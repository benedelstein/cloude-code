import { z } from "zod/v4";
import type { UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai";
import { ActiveTurnState, AgentMode, SessionStatus } from "../session";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MessageAttachmentRef,
} from "./attachments";

// Re-export AI SDK types for convenience
export type { UIMessage, UIMessagePart };

/**
 * Typed pass-through for values owned by another library (the AI SDK):
 * validates as unknown (the owning library defines the real shape), infers as
 * T for TypeScript consumers, and transpiles to an opaque JSONValue in Swift.
 */
function wireOpaque<T>(): z.ZodType<T> {
  return z.unknown() as unknown as z.ZodType<T>;
}

// ------------------------------------------------------------
// Client → Server messages
// ------------------------------------------------------------
export const ChatMessageEvent = z.object({
  type: z.literal("chat.message"),
  content: z.string().trim().min(1).optional(),
  attachments: z.array(MessageAttachmentRef).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  messageId: z.uuid().optional(),
  /** If provided, switch to this model before processing the message. */
  model: z.string().optional(),
  /** If provided, switch provider effort before processing the message. */
  effort: z.string().optional(),
  /** If provided, switch agent mode before processing the message. */
  agentMode: AgentMode.optional(),
}).refine(
  (value) => Boolean(value.content) || (value.attachments?.length ?? 0) > 0,
  "chat.message must include content or attachments",
);
export type ChatMessageEvent = z.infer<typeof ChatMessageEvent>;

export const SyncRequestEvent = z.object({
  type: z.literal("sync.request"),
  lastMessageId: z.uuid().optional(),
  lastChunkIndex: z.number().int().optional(),
});
export type SyncRequestEvent = z.infer<typeof SyncRequestEvent>;

export const SessionMarkReadEvent = z.object({
  type: z.literal("session.mark_read"),
  messageId: z.string().min(1),
});
export type SessionMarkReadEvent = z.infer<typeof SessionMarkReadEvent>;

export const OperationCancelEvent = z.object({
  type: z.literal("operation.cancel"),
});
export type OperationCancelEvent = z.infer<typeof OperationCancelEvent>;

export const ClientMessage = z.discriminatedUnion("type", [
  ChatMessageEvent,
  SyncRequestEvent,
  SessionMarkReadEvent,
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

// Zod schema for UIMessage. Inference matches the AI SDK's UIMessage type, so
// parsed values are directly usable as UIMessage.
export const UIMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(wireOpaque<UIMessagePart<UIDataTypes, UITools>>()),
  metadata: z.unknown().optional(),
});

export const SyncResponseEvent = z.object({
  type: z.literal("sync.response"),
  messages: z.array(UIMessageSchema),
  pendingChunks: z.array(z.unknown()).optional(),
  activeTurn: ActiveTurnState.nullable(),
});
export type SyncResponseEvent = z.infer<typeof SyncResponseEvent>;

/**
 * Transient error codes from operations (sending a message, etc)
 */
export const OperationErrorCode = z.enum([
  "INVALID_MESSAGE",
  "MESSAGE_HANDLER_ERROR",
  "CHAT_MESSAGE_FAILED",
  "GITHUB_AUTH_REQUIRED",
  "REPO_ACCESS_BLOCKED",
]);
export type OperationErrorCode = z.infer<typeof OperationErrorCode>;

export const OperationErrorEvent = z.object({
  type: z.literal("operation.error"),
  code: OperationErrorCode,
  message: z.string(),
});
export type OperationErrorEvent = z.infer<typeof OperationErrorEvent>;

// AI SDK UIMessageStream chunks (for real-time streaming, batched per webhook delivery)
export const AgentChunksEvent = z.object({
  type: z.literal("agent.chunks"),
  chunks: z.array(z.unknown()), // UIMessageStreamPart[] from AI SDK
});
export type AgentChunksEvent = z.infer<typeof AgentChunksEvent>;

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
  AgentChunksEvent,
  AgentFinishEvent,
  AgentReadyEvent,
  UserMessageEvent,
  EditorReadyEvent,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
