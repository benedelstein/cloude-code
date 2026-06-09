import { z } from "zod";
import type { UIMessage, UIMessageChunk } from "ai";
import { AgentMode } from "./session";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "./attachments";

// Re-export AI SDK types
export type { UIMessage, UIMessageChunk };

// ============================================
// VM Agent Input (api-server → vm-agent stdin)
// ============================================

export const AgentInputAttachment = z.object({
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  dataUrl: z.string().min(1),
});
export type AgentInputAttachment = z.infer<typeof AgentInputAttachment>;

export const AgentInputMessage = z.object({
  content: z.string().trim().min(1).optional(),
  attachments: z.array(AgentInputAttachment).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
}).refine(
  (value) => Boolean(value.content) || (value.attachments?.length ?? 0) > 0,
  {
    message: "Agent chat input must include content or attachments",
    path: ["content"],
  },
);
export type AgentInputMessage = z.infer<typeof AgentInputMessage>;

export const AgentChatInput = z.object({
  type: z.literal("chat"),
  message: AgentInputMessage,
  /** Identifier of the user message this turn belongs to. */
  userMessageId: z.string().min(1),
  /** If provided, switch to this model before processing the message. */
  model: z.string().optional(),
  /** If provided, switch provider effort before processing the message. */
  effort: z.string().optional(),
  /** If provided, switch agent mode before processing the message. */
  agentMode: AgentMode.optional(),
});

export const AgentCancelInput = z.object({
  type: z.literal("cancel"),
  userMessageId: z.string().min(1),
});

export const AgentInput = z.discriminatedUnion("type", [
  AgentChatInput,
  AgentCancelInput,
]);
export type AgentInput = z.infer<typeof AgentInput>;

// ============================================
// VM Agent Output (vm-agent stdout → api-server)
// ============================================

// Agent is ready to receive messages
export const AgentReadyOutput = z.object({
  type: z.literal("ready"),
  // sessionId: z.string(),
});

// Fatal agent error
export const AgentErrorOutput = z.object({
  type: z.literal("error"),
  error: z.string(),
});

// AI SDK stream chunk wrapper
export const AgentStreamOutput = z.object({
  type: z.literal("stream"),
  chunk: z.unknown(), // UIMessageChunk from AI SDK
});
export type AgentStreamOutput = z.infer<typeof AgentStreamOutput>;

export const SequencedAgentStreamChunk = z.object({
  sequence: z.number().int().nonnegative(),
  chunk: z.unknown(), // UIMessageChunk from AI SDK
});
export type SequencedAgentStreamChunk = z.infer<
  typeof SequencedAgentStreamChunk
>;

export const AgentDebugOutput = z.object({
  type: z.literal("debug"),
  message: z.string(),
});

// Claude session ID (for resuming sessions)
export const AgentSessionIdOutput = z.object({
  type: z.literal("sessionId"),
  sessionId: z.string(),
});

/** Sent while the agent is mid-response to keep listeners alive. */
export const AgentHeartbeatOutput = z.object({
  type: z.literal("heartbeat"),
});

/** Sent immediately before the webhook vm-agent exits. */
export const AgentProcessExitOutput = z.object({
  type: z.literal("process_exit"),
  processRunId: z.string().min(1),
  exitCode: z.number().int(),
});

export const AgentStdinAckOutput = z.object({
  type: z.literal("stdin_ack"),
  userMessageId: z.string().min(1),
});

export const AgentCancelAckOutput = z.object({
  type: z.literal("cancel_ack"),
  userMessageId: z.string().min(1),
});

/**
 * Non-stream agent events accepted by the API webhook route. The vm-agent
 * posts ready, error, sessionId, and process_exit to /events; heartbeat and
 * debug are local stdout/logging signals.
 */
export const AgentEvent = z.discriminatedUnion("type", [
  AgentReadyOutput,
  AgentDebugOutput,
  AgentErrorOutput,
  AgentSessionIdOutput,
  AgentHeartbeatOutput,
  AgentProcessExitOutput,
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

/**
 * All agent output types, including stream chunks and local stdin acks.
 */
export const AgentOutput = z.discriminatedUnion("type", [
  ...AgentEvent.options,
  AgentStreamOutput,
  AgentStdinAckOutput,
  AgentCancelAckOutput,
]);
export type AgentOutput = z.infer<typeof AgentOutput>;

// ============================================
// Webhook body types
// ============================================

export const AgentChunksWebhookBody = z.object({
  userMessageId: z.string().min(1),
  chunks: z.array(SequencedAgentStreamChunk),
});
export type AgentChunksWebhookBody = z.infer<typeof AgentChunksWebhookBody>;

export const AgentEventsWebhookBody = z.object({
  event: AgentEvent,
});
export type AgentEventsWebhookBody = z.infer<typeof AgentEventsWebhookBody>;

// ============================================
// Helper functions for encoding/decoding
// ============================================

export function encodeAgentInput(input: AgentInput): string {
  return JSON.stringify(input);
}

export function decodeAgentInput(line: string): AgentInput {
  return AgentInput.parse(JSON.parse(line));
}

export function encodeAgentOutput(output: AgentOutput): string {
  return JSON.stringify(output);
}

export function decodeAgentOutput(line: string): AgentOutput {
  return AgentOutput.parse(JSON.parse(line));
}
