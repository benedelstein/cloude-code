import { z } from "zod";
import type { UIMessage, UIMessageChunk } from "ai";

// Re-export AI SDK types
export type { UIMessage, UIMessageChunk };

// ============================================
// VM Agent Input (api-server → vm-agent stdin)
// ============================================

export const AgentChatInput = z.object({
  type: z.literal("chat"),
  content: z.string(),
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

export const AgentOutput = z.discriminatedUnion("type", [
  AgentReadyOutput,
  AgentDebugOutput,
  AgentErrorOutput,
  AgentStreamOutput,
  AgentSessionIdOutput,
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
