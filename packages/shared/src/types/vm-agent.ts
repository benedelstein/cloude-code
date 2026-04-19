import { z } from "zod";
import type { UIMessage, UIMessageChunk } from "ai";
import { AgentMode } from "./session";

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
  attachments: z.array(AgentInputAttachment).max(20).optional(),
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
  /** If provided, switch to this model before processing the message. */
  model: z.string().optional(),
  /** If provided, switch agent mode before processing the message. */
  agentMode: AgentMode.optional(),
});

export const AgentCancelInput = z.object({
  type: z.literal("cancel"),
});

export const AgentResumeInput = z.object({
  type: z.literal("resume"),
  sessionId: z.string(),
});

export const AgentInput = z.discriminatedUnion("type", [
  AgentChatInput,
  AgentCancelInput,
  AgentResumeInput,
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

export const AgentOutput = z.discriminatedUnion("type", [
  AgentReadyOutput,
  AgentDebugOutput,
  AgentErrorOutput,
  AgentStreamOutput,
  AgentSessionIdOutput,
  AgentHeartbeatOutput,
]);
export type AgentOutput = z.infer<typeof AgentOutput>;

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
