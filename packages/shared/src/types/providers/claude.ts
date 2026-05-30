import { z } from "zod";
import type { ProviderDefinition, ProviderModelDefinition } from "./shared";

export const ClaudeModel = z.enum([
  "opus",
  "opus-1m",
  "sonnet",
  "haiku",
  "opus-4-7",
  "opus-4-7-1m",
  "opus-4-6",
]);
export type ClaudeModel = z.infer<typeof ClaudeModel>;

export const CLAUDE_MODEL_DISPLAY_NAMES: Record<ClaudeModel, string> = {
  opus: "Claude Opus 4.8",
  "opus-1m": "Claude Opus 4.8 (1M context)",
  sonnet: "Claude Sonnet 4.6",
  haiku: "Claude Haiku 4.5",
  "opus-4-7": "Claude Opus 4.7 [Legacy]",
  "opus-4-7-1m": "Claude Opus 4.7 (1M context) [Legacy]",
  "opus-4-6": "Claude Opus 4.6 [Legacy]",
};

export const CLAUDE_PROVIDER_ID = "claude-code" as const;

export const AgentSettingsClaude = z.object({
  provider: z.literal(CLAUDE_PROVIDER_ID),
  model: ClaudeModel.default("opus"),
  maxTokens: z.number().default(8192),
});

const CLAUDE_MODELS: ProviderModelDefinition<ClaudeModel>[] = [
  { id: "opus", displayName: CLAUDE_MODEL_DISPLAY_NAMES.opus, isDefault: true },
  { id: "opus-1m", displayName: CLAUDE_MODEL_DISPLAY_NAMES["opus-1m"], isDefault: false },
  { id: "sonnet", displayName: CLAUDE_MODEL_DISPLAY_NAMES.sonnet, isDefault: false },
  { id: "haiku", displayName: CLAUDE_MODEL_DISPLAY_NAMES.haiku, isDefault: false },
  { id: "opus-4-7", displayName: CLAUDE_MODEL_DISPLAY_NAMES["opus-4-7"], isDefault: false },
  { id: "opus-4-7-1m", displayName: CLAUDE_MODEL_DISPLAY_NAMES["opus-4-7-1m"], isDefault: false },
  { id: "opus-4-6", displayName: CLAUDE_MODEL_DISPLAY_NAMES["opus-4-6"], isDefault: false },
];

export const CLAUDE_PROVIDER: ProviderDefinition<typeof CLAUDE_PROVIDER_ID, ClaudeModel> = {
  id: CLAUDE_PROVIDER_ID,
  displayName: "Claude Code",
  defaultModel: "opus",
  authMethods: ["oauth"],
  todoToolName: "TodoWrite",
  models: CLAUDE_MODELS,
};
