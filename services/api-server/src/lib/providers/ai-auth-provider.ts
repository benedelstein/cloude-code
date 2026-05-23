import type { Logger, ProviderId } from "@repo/shared";
import { ClaudeOAuthService } from "@/lib/ai-auth/claude-oauth-service";
import { OpenAICodexAuthService } from "@/lib/ai-auth/openai-codex-auth-service";
import type { Env } from "@/types";
import type { ProviderConnectionStatus } from "@/lib/ai-auth/connection-status";

export { ClaudeOAuthError } from "@/lib/ai-auth/claude-oauth-service";

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

export function getClaudeOAuthProvider(env: Env, logger: Logger): ClaudeOAuthService {
  return new ClaudeOAuthService(env, logger);
}

export function getOpenAICodexAuthProvider(
  env: Env,
  logger: Logger,
): OpenAICodexAuthService {
  return new OpenAICodexAuthService(env, logger);
}
