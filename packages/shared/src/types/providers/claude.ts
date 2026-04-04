import { z } from "zod";

export const ClaudeModel = z.enum(["opus", "sonnet", "haiku"]);
export type ClaudeModel = z.infer<typeof ClaudeModel>;

export const CLAUDE_MODEL_DISPLAY_NAMES: Record<ClaudeModel, string> = {
  opus: "Claude Opus 4.6",
  sonnet: "Claude Sonnet 4.6",
  haiku: "Claude Haiku 4.5",
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
  models: [
    { id: "opus" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES.opus, isDefault: true },
    { id: "sonnet" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES.sonnet, isDefault: false },
    { id: "haiku" as const, displayName: CLAUDE_MODEL_DISPLAY_NAMES.haiku, isDefault: false },
  ],
};
