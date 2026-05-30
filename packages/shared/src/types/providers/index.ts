import { z } from "zod";
import { AgentSettingsClaude, CLAUDE_PROVIDER, CLAUDE_PROVIDER_ID } from "./claude";
import { AgentSettingsCodex, OPENAI_CODEX_PROVIDER, OPENAI_CODEX_PROVIDER_ID } from "./openai-codex";
import type {
  ProviderDefinition,
  ProviderEffortDefinition,
  ProviderEffortId,
  ProviderModelDefinition,
  ProviderModelId,
} from "./shared";

export * from "./claude";
export * from "./openai-codex";
export * from "./shared";

export const ProviderId = z.enum([CLAUDE_PROVIDER_ID, OPENAI_CODEX_PROVIDER_ID]);
export type ProviderId = z.infer<typeof ProviderId>;

export const PROVIDERS: Record<ProviderId, ProviderDefinition<ProviderId>> = {
  "claude-code": CLAUDE_PROVIDER,
  "openai-codex": OPENAI_CODEX_PROVIDER,
};

export const PROVIDER_LIST: ProviderDefinition<ProviderId>[] = Object.values(PROVIDERS);

export function getProviderDefinition(providerId: ProviderId): ProviderDefinition<ProviderId> {
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

export function getProviderEffortIds(providerId: ProviderId): ProviderEffortId[] {
  return PROVIDERS[providerId].efforts.map((effort) => effort.id);
}

export function getProviderEffortDefinition(
  providerId: ProviderId,
  effortId: string,
): ProviderEffortDefinition | null {
  return PROVIDERS[providerId].efforts.find((effort) => effort.id === effortId) ?? null;
}

export function isProviderEffort(providerId: ProviderId, effortId: string): boolean {
  return getProviderEffortDefinition(providerId, effortId) !== null;
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
