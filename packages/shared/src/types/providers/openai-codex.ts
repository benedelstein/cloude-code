import { z } from "zod";
import type { ProviderDefinition, ProviderEffortDefinition, ProviderModelDefinition } from "./shared";

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

export const OpenAICodexEffort = z.enum(["low", "medium", "high", "xhigh"]);
export type OpenAICodexEffort = z.infer<typeof OpenAICodexEffort>;

export const OPENAI_CODEX_MODEL_DISPLAY_NAMES: Record<OpenAICodexModel, string> = {
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.2-codex": "GPT-5.2 Codex",
  // "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
  "gpt-5.2": "GPT-5.2",
};

export const OPENAI_CODEX_EFFORT_DISPLAY_NAMES: Record<OpenAICodexEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex" as const;

export const AgentSettingsCodex = z.object({
  provider: z.literal(OPENAI_CODEX_PROVIDER_ID),
  model: OpenAICodexModel.default("gpt-5.5"),
  effort: OpenAICodexEffort.default("high"),
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

const OPENAI_CODEX_EFFORTS: ProviderEffortDefinition<OpenAICodexEffort>[] = [
  { id: "low", displayName: OPENAI_CODEX_EFFORT_DISPLAY_NAMES.low, isDefault: false },
  { id: "medium", displayName: OPENAI_CODEX_EFFORT_DISPLAY_NAMES.medium, isDefault: false },
  { id: "high", displayName: OPENAI_CODEX_EFFORT_DISPLAY_NAMES.high, isDefault: true },
  { id: "xhigh", displayName: OPENAI_CODEX_EFFORT_DISPLAY_NAMES.xhigh, isDefault: false },
];

export const OPENAI_CODEX_PROVIDER: ProviderDefinition<
  typeof OPENAI_CODEX_PROVIDER_ID,
  OpenAICodexModel,
  OpenAICodexEffort
> = {
  id: OPENAI_CODEX_PROVIDER_ID,
  displayName: "OpenAI Codex",
  defaultModel: "gpt-5.5",
  defaultEffort: "high",
  authMethods: ["oauth"],
  todoToolName: "update_plan",
  models: OPENAI_CODEX_MODELS,
  efforts: OPENAI_CODEX_EFFORTS,
};
