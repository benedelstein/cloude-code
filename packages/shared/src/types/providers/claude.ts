import { z } from "zod";

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
  "opus-4-7": "Claude Opus 4.7 Legacy",
  "opus-4-7-1m": "Claude Opus 4.7 (1M context) Legacy",
  "opus-4-6": "Claude Opus 4.6 Legacy",
};

export const CLAUDE_PROVIDER_ID = "claude-code" as const;

export const AgentSettingsClaude = z.object({
  provider: z.literal(CLAUDE_PROVIDER_ID),
  model: ClaudeModel.default("opus"),
  maxTokens: z.number().default(8192),
});

export const CLAUDE_PROVIDER = {
  id: CLAUDE_PROVIDER_ID,
  displayName: "Claude Code",
  defaultModel: "opus" as const,
  authMethods: ["oauth" as const],
  todoToolName: "TodoWrite",
  models: [
    { id: "opus" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES.opus, isDefault: true },
    { id: "opus-1m" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES["opus-1m"], isDefault: false },
    { id: "sonnet" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES.sonnet, isDefault: false },
    { id: "haiku" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES.haiku, isDefault: false },
    { id: "opus-4-7" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES["opus-4-7"], isDefault: false },
    { id: "opus-4-7-1m" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES["opus-4-7-1m"], isDefault: false },
    { id: "opus-4-6" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES["opus-4-6"], isDefault: false },
  ],
};
