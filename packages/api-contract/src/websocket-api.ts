import { z } from "zod/v4";
import { ActiveTurnState, AgentMode, SessionStatus } from "./session";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MessageAttachmentRef,
} from "./attachments";
import { WireUIMessageChunkSchema, WireUIMessageSchema } from "./ui-message";

// ------------------------------------------------------------
// Client → Server messages
// ------------------------------------------------------------
export const ChatMessageEvent = z.object({
  type: z.literal("chat.message"),
  content: z.string().trim().min(1).optional(),
  attachments: z.array(MessageAttachmentRef).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  clientMessageId: z.uuid()
    .optional()
    .describe("Caller-generated correlation id for optimistic UI reconciliation; not the durable message id."),
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

export const MessageStreamMetadata = z.object({
  startedAt: z.iso.datetime(),
});
export type MessageStreamMetadata = z.infer<typeof MessageStreamMetadata>;

export const SyncResponseEvent = z.object({
  type: z.literal("sync.response"),
  messages: z.array(WireUIMessageSchema),
  pendingChunks: z.array(WireUIMessageChunkSchema).optional(),
  pendingMessageMetadata: MessageStreamMetadata.optional(),
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
  chunks: z.array(WireUIMessageChunkSchema),
  messageMetadata: MessageStreamMetadata.optional(),
});
export type AgentChunksEvent = z.infer<typeof AgentChunksEvent>;

// Agent message finished (accumulated UIMessage saved)
export const AgentFinishEvent = z.object({
  type: z.literal("agent.finish"),
  message: WireUIMessageSchema,
});
export type AgentFinishEvent = z.infer<typeof AgentFinishEvent>;

export const AgentReadyEvent = z.object({
  type: z.literal("agent.ready"),
});
export type AgentReadyEvent = z.infer<typeof AgentReadyEvent>;

export const UserMessageEvent = z.object({
  type: z.literal("user.message"),
  message: WireUIMessageSchema,
});
export type UserMessageEvent = z.infer<typeof UserMessageEvent>;

export const ChatAcceptedEvent = z.object({
  type: z.literal("chat.accepted"),
  /**
   * Caller-generated correlation id from chat.message; used only to reconcile local optimistic UI.
   */
  clientMessageId: z.string(),
  /**
   * Server-generated durable UIMessage.id; also used by activeTurn.userMessageId.
   */
  messageId: z.string(),
});
export type ChatAcceptedEvent = z.infer<typeof ChatAcceptedEvent>;

export const EditorReadyEvent = z.object({
  type: z.literal("editor.ready"),
  url: z.string(),
  token: z.string(),
});
export type EditorReadyEvent = z.infer<typeof EditorReadyEvent>;

// Live setup-script output (batched stdout/stderr, broadcast while the script runs)
export const SetupOutputChunk = z.object({
  stream: z.enum(["stdout", "stderr"]),
  data: z.string(),
  /** Char offset of this chunk within its stream; lets clients dedup against a fetched snapshot. */
  offset: z.number().int(),
});
export type SetupOutputChunk = z.infer<typeof SetupOutputChunk>;

export const SetupOutputChunksEvent = z.object({
  type: z.literal("setup.output.chunks"),
  taskId: z.literal("setup_script"),
  /** Unique per script run; clients reset accumulated output when it changes. */
  epoch: z.string(),
  chunks: z.array(SetupOutputChunk),
});
export type SetupOutputChunksEvent = z.infer<typeof SetupOutputChunksEvent>;

export const ServerMessage = z.discriminatedUnion("type", [
  ConnectedEvent,
  SyncResponseEvent,
  OperationErrorEvent,
  AgentChunksEvent,
  AgentFinishEvent,
  AgentReadyEvent,
  UserMessageEvent,
  ChatAcceptedEvent,
  EditorReadyEvent,
  SetupOutputChunksEvent,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
