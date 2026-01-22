import { z } from "zod";

// Client → Server messages
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

// Server → Client messages
export const ConnectedEvent = z.object({
  type: z.literal("connected"),
  sessionId: z.string().uuid(),
  status: z.string(),
  lastMessageId: z.string().uuid().optional(),
});
export type ConnectedEvent = z.infer<typeof ConnectedEvent>;

export const MessageStartEvent = z.object({
  type: z.literal("message.start"),
  messageId: z.string().uuid(),
});
export type MessageStartEvent = z.infer<typeof MessageStartEvent>;

export const StreamChunkEvent = z.object({
  type: z.literal("stream.chunk"),
  messageId: z.string().uuid(),
  chunkIndex: z.number(),
  content: z.string(),
});
export type StreamChunkEvent = z.infer<typeof StreamChunkEvent>;

export const MessageCompleteEvent = z.object({
  type: z.literal("message.complete"),
  messageId: z.string().uuid(),
  totalChunks: z.number(),
});
export type MessageCompleteEvent = z.infer<typeof MessageCompleteEvent>;

export const ToolUseEvent = z.object({
  type: z.literal("tool.use"),
  toolCallId: z.string().uuid(),
  messageId: z.string().uuid(),
  toolName: z.string(),
  input: z.record(z.unknown()),
});
export type ToolUseEvent = z.infer<typeof ToolUseEvent>;

export const ToolResultEvent = z.object({
  type: z.literal("tool.result"),
  toolCallId: z.string().uuid(),
  output: z.string(),
  isError: z.boolean().optional(),
});
export type ToolResultEvent = z.infer<typeof ToolResultEvent>;

export const SpriteStatusEvent = z.object({
  type: z.literal("sprite.status"),
  status: z.enum(["provisioning", "ready", "waking", "hibernating", "error"]),
  message: z.string().optional(),
});
export type SpriteStatusEvent = z.infer<typeof SpriteStatusEvent>;

export const SyncResponseEvent = z.object({
  type: z.literal("sync.response"),
  messages: z.array(z.unknown()),
  pendingChunks: z.array(z.unknown()).optional(),
});
export type SyncResponseEvent = z.infer<typeof SyncResponseEvent>;

export const ErrorEvent = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});
export type ErrorEvent = z.infer<typeof ErrorEvent>;

// Agent SDK message events (forwarded from vm-agent)
export const ClaudeSdkEvent = z.object({
  type: z.literal("claude.sdk"),
  message: z.unknown(), // SDKMessage from @anthropic-ai/claude-agent-sdk
});
export type ClaudeSdkEvent = z.infer<typeof ClaudeSdkEvent>;

export const ClaudeReadyEvent = z.object({
  type: z.literal("claude.ready"),
  agentSessionId: z.string(),
});
export type ClaudeReadyEvent = z.infer<typeof ClaudeReadyEvent>;

export const ServerMessage = z.discriminatedUnion("type", [
  ConnectedEvent,
  MessageStartEvent,
  StreamChunkEvent,
  MessageCompleteEvent,
  ToolUseEvent,
  ToolResultEvent,
  SpriteStatusEvent,
  SyncResponseEvent,
  ErrorEvent,
  ClaudeSdkEvent,
  ClaudeReadyEvent,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
