import { z } from "zod";
import { AgentSettingsClaude, CLAUDE_PROVIDER, CLAUDE_PROVIDER_ID } from "./claude";
import { AgentSettingsCodex, OPENAI_CODEX_PROVIDER, OPENAI_CODEX_PROVIDER_ID } from "./openai-codex";

export * from "./claude";
export * from "./openai-codex";

export const AuthMethod = z.enum(["oauth"]);
export type AuthMethod = z.infer<typeof AuthMethod>;

export const ProviderId = z.enum([CLAUDE_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID]);
export type ProviderId = z.infer<typeof ProviderId>;

export type ProviderModelId = string;

export type ProviderModelDefinition = {
  id: ProviderModelId;
  displayName: string;
  isDefault: boolean;
};

export type ProviderDefinition = {
  id: ProviderId;
  displayName: string;
  defaultModel: ProviderModelId;
  authMethods: AuthMethod[];
  models: ProviderModelDefinition[];
  todoToolName: string;
};

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  "claude-code": CLAUDE_PROVIDER,
  "openai-codex": OPENAI_CODEX_PROVIDER,
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

export function getProviderDefinition(providerId: ProviderId): ProviderDefinition {
  return PROVIDERS[providerId];
}

export function getProviderTodoToolName(providerId: ProviderId): string {
  return getProviderDefinition(providerId).todoToolName;
}

export function isProviderTodoToolName(toolName: string): boolean {
  return PROVIDER_LIST.some((provider) => provider.todoToolName === toolName);
}

export function getProviderModelIds(providerId: ProviderId): ProviderModelId[] {
  return PROVIDERS[providerId].models.map((model) => model.id);
}

export function getProviderModelDefinition(
  providerId: ProviderId,
  modelId: string,
): ProviderModelDefinition | null {
  return PROVIDERS[providerId].models.find((model) => model.id === modelId) ?? null;
}

export function isProviderModel(providerId: ProviderId, modelId: string): boolean {
  return getProviderModelDefinition(providerId, modelId) !== null;
}

export { AgentSettingsClaude, AgentSettingsCodex };

export const AgentSettings = z.discriminatedUnion("provider", [
  AgentSettingsCodex,
  AgentSettingsClaude,
]);
export type AgentSettings = z.infer<typeof AgentSettings>;

// Compile-time check: every ProviderId must have a corresponding AgentSettings variant.
// Adding a new ProviderId without a matching AgentSettings entry will cause a type error here.
export declare const _agentSettingsExhaustiveCheck: [AgentSettings["provider"]] extends [ProviderId]
  ? [ProviderId] extends [AgentSettings["provider"]]
    ? true
    : never
  : never;
