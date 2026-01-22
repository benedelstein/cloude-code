import { z } from "zod";

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

// Wrapper for SDK messages (we use z.unknown() since SDK types aren't Zod)
export const AgentSdkOutput = z.object({
  type: z.literal("sdk"),
  message: z.unknown(), // SDKMessage from @anthropic-ai/claude-agent-sdk
});

export const AgentReadyOutput = z.object({
  type: z.literal("ready"),
  sessionId: z.string(),
});

export const AgentErrorOutput = z.object({
  type: z.literal("error"),
  error: z.string(),
});

export const AgentOutput = z.discriminatedUnion("type", [
  AgentSdkOutput,
  AgentReadyOutput,
  AgentErrorOutput,
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
