import { z } from "zod";
import type { ProviderDefinition, ProviderModelDefinition } from "./shared";

export const OpenAICodexModel = z.enum([
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  // "gpt-5.1-codex-max",
  "gpt-5.2",
]);
export type OpenAICodexModel = z.infer<typeof OpenAICodexModel>;

export const OPENAI_CODEX_MODEL_DISPLAY_NAMES: Record<OpenAICodexModel, string> = {
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.2-codex": "GPT-5.2 Codex",
  // "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
  "gpt-5.2": "GPT-5.2",
};

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex" as const;

export const AgentSettingsCodex = z.object({
  provider: z.literal(OPENAI_CODEX_PROVIDER_ID),
  model: OpenAICodexModel.default("gpt-5.5"),
  maxTokens: z.number().default(8192),
});

const OPENAI_CODEX_MODELS: ProviderModelDefinition<OpenAICodexModel>[] = [
  {
    id: "gpt-5.5",
    displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.5"],
    isDefault: true,
  },
  {
    id: "gpt-5.4",
    displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.4"],
    isDefault: false,
  },
  {
    id: "gpt-5.4-mini",
    displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.4-mini"],
    isDefault: false,
  },
  {
    id: "gpt-5.3-codex",
    displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.3-codex"],
    isDefault: true,
  },
  // {
  //   id: "gpt-5.2-codex",
  //   displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.2-codex"],
  //   isDefault: false,
  // },
  // {
  //   id: "gpt-5.1-codex-max",
  //   displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.1-codex-max"],
  //   isDefault: false,
  // },
  {
    id: "gpt-5.2",
    displayName: OPENAI_CODEX_MODEL_DISPLAY_NAMES["gpt-5.2"],
    isDefault: false,
  },
];

export const OPENAI_CODEX_PROVIDER: ProviderDefinition<typeof OPENAI_CODEX_PROVIDER_ID, OpenAICodexModel> = {
  id: OPENAI_CODEX_PROVIDER_ID,
  displayName: "OpenAI Codex",
  defaultModel: "gpt-5.5",
  authMethods: ["oauth"],
  todoToolName: "update_plan",
  models: OPENAI_CODEX_MODELS,
};
