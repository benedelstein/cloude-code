import { z } from "zod";

export const OpenAICodexModel = z.enum([
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
]);
export type OpenAICodexModel = z.infer<typeof OpenAICodexModel>;

export const OPENAI_CODEX_MODEL_DISPLAY_NAMES: Record<OpenAICodexModel, string> = {
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.2-codex": "GPT-5.2 Codex",
  "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
  "gpt-5.2": "GPT-5.2",
};

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex" as const;

export const AgentSettingsCodex = z.object({
  provider: z.literal(OPENAI_CODEX_PROVIDER_ID),
  model: OpenAICodexModel.default("gpt-5.3-codex"),
  maxTokens: z.number().default(8192),
});

export const OPENAI_CODEX_PROVIDER = {
  id: OPENAI_CODEX_PROVIDER_ID,
  displayName: "OpenAI Codex",
  defaultModel: "gpt-5.3-codex" as const,
  authMethods: ["oauth" as const],
  todoToolName: "update_plan",
  models: [
    {
      id: "gpt-5.3-codex" as const,
      displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.3-codex"],
      isDefault: true,
    },
    {
      id: "gpt-5.2-codex" as const,
      displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.2-codex"],
      isDefault: false,
    },
    {
      id: "gpt-5.1-codex-max" as const,
      displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.1-codex-max"],
      isDefault: false,
    },
    {
      id: "gpt-5.2" as const,
      displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.2"],
      isDefault: false,
    },
  ],
};
