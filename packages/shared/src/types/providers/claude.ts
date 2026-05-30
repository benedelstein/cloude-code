import { z } from "zod";
import type { ProviderDefinition, ProviderEffortDefinition, ProviderModelDefinition } from "./shared";

export const ClaudeModel = z.enum([
  "claude-opus-4-8",
  "claude-opus-4-8[1m]",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-opus-4-7",
  "claude-opus-4-7[1m]",
]);
export type ClaudeModel = z.infer<typeof ClaudeModel>;

export const ClaudeEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type ClaudeEffort = z.infer<typeof ClaudeEffort>;

export const CLAUDE_MODEL_DISPLAY_NAMES: Record<ClaudeModel, string> = {
  "claude-opus-4-8": "Claude Opus 4.8",
  "claude-opus-4-8[1m]": "Claude Opus 4.8 (1M context)",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-opus-4-7": "Claude Opus 4.7 [Legacy]",
  "claude-opus-4-7[1m]": "Claude Opus 4.7 (1M context) [Legacy]",
};

export const CLAUDE_EFFORT_DISPLAY_NAMES: Record<ClaudeEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export const CLAUDE_PROVIDER_ID = "claude-code" as const;

export const AgentSettingsClaude = z.object({
  provider: z.literal(CLAUDE_PROVIDER_ID),
  model: ClaudeModel.default("claude-opus-4-8"),
  effort: ClaudeEffort.default("high"),
  maxTokens: z.number().default(8192),
});

const CLAUDE_MODELS: ProviderModelDefinition<ClaudeModel>[] = [
  { id: "claude-opus-4-8", displayName: CLAUDE_MODEL_DISPLAY_NAMES["claude-opus-4-8"], isDefault: true },
  { id: "claude-opus-4-8[1m]", displayName: CLAUDE_MODEL_DISPLAY_NAMES["claude-opus-4-8[1m]"], isDefault: false },
  { id: "claude-sonnet-4-6", displayName: CLAUDE_MODEL_DISPLAY_NAMES["claude-sonnet-4-6"], isDefault: false },
  { id: "claude-haiku-4-5", displayName: CLAUDE_MODEL_DISPLAY_NAMES["claude-haiku-4-5"], isDefault: false },
  { id: "claude-opus-4-7", displayName: CLAUDE_MODEL_DISPLAY_NAMES["claude-opus-4-7"], isDefault: false },
  { id: "claude-opus-4-7[1m]", displayName: CLAUDE_MODEL_DISPLAY_NAMES["claude-opus-4-7[1m]"], isDefault: false },
];

const CLAUDE_EFFORTS: ProviderEffortDefinition<ClaudeEffort>[] = [
  { id: "low", displayName: CLAUDE_EFFORT_DISPLAY_NAMES.low, isDefault: false },
  { id: "medium", displayName: CLAUDE_EFFORT_DISPLAY_NAMES.medium, isDefault: false },
  { id: "high", displayName: CLAUDE_EFFORT_DISPLAY_NAMES.high, isDefault: true },
  { id: "xhigh", displayName: CLAUDE_EFFORT_DISPLAY_NAMES.xhigh, isDefault: false },
  { id: "max", displayName: CLAUDE_EFFORT_DISPLAY_NAMES.max, isDefault: false },
];

export const CLAUDE_PROVIDER: ProviderDefinition<typeof CLAUDE_PROVIDER_ID, ClaudeModel, ClaudeEffort> = {
  id: CLAUDE_PROVIDER_ID,
  displayName: "Claude Code",
  defaultModel: "claude-opus-4-8",
  defaultEffort: "high",
  authMethods: ["oauth"],
  todoToolName: "TodoWrite",
  models: CLAUDE_MODELS,
  efforts: CLAUDE_EFFORTS,
};
