import type { Logger, ProviderId } from "@repo/shared";
import { ClaudeOAuthService } from "./claude-oauth-service";
import { OpenAICodexAuthService } from "./openai-codex-auth-service";
import type { Env } from "@/types";
import type { ProviderConnectionStatus } from "./connection-status";

/* eslint-disable no-unused-vars */
export interface ProviderAuthService<TCredentials> {
  getConnectionStatus(_userId: string): Promise<ProviderConnectionStatus>;
  disconnect(_userId: string): Promise<void>;
  getValidCredentials(_userId: string): Promise<TCredentials>;
  refreshCredentialsIfNeeded(_userId: string): Promise<TCredentials>;
}

/**
 * Returns the provider auth service for the given provider.
 * @param providerId Provider identifier.
 * @param env Worker environment.
 * @param logger Logger for provider service construction.
 * @returns Provider-specific auth service.
 */
export function getProviderAuthService(
  providerId: ProviderId,
  env: Env,
  logger: Logger,
): ProviderAuthService<unknown> {
  switch (providerId) {
    case "claude-code":
      return new ClaudeOAuthService(env, logger);
    case "openai-codex":
      return new OpenAICodexAuthService(env, logger);
    default: {
      const exhaustiveCheck: never = providerId;
      throw new Error(`Unhandled provider: ${exhaustiveCheck}`);
    }
  }
}

