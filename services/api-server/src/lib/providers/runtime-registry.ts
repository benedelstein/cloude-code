import type { Logger, ProviderId } from "@repo/shared";
import { ClaudeOAuthService } from "@/lib/claude-oauth-service";
import { sha256 } from "@/lib/crypto";
import { OpenAICodexAuthService } from "@/lib/openai-codex-auth-service";
import type { Env } from "@/types";

export type ProviderConnectionStatus = {
  connected: boolean;
  requiresReauth: boolean;
};

/* eslint-disable no-unused-vars */
export interface ProviderAuthService<TCredentials> {
  getConnectionStatus(_userId: string): Promise<ProviderConnectionStatus>;
  disconnect(_userId: string): Promise<void>;
  getValidCredentials(_userId: string): Promise<TCredentials>;
  refreshCredentialsIfNeeded(_userId: string): Promise<TCredentials>;
}

export interface AuthCredentialSnapshot {
  connectionStatus: ProviderConnectionStatus;
  syncToken: string;
  files: Array<{
    path: string;
    contents: string;
    mode?: string;
  }>;
  envVars: Record<string, string>;
}

export interface ProviderCredentialAdapter {
  getCredentialSnapshot(_userId: string): Promise<AuthCredentialSnapshot>;
}
/* eslint-enable no-unused-vars */

class ClaudeProviderCredentialAdapter implements ProviderCredentialAdapter {
  private readonly service: ClaudeOAuthService;

  constructor(env: Env, logger: Logger) {
    this.service = new ClaudeOAuthService(env, logger);
  }

  async getCredentialSnapshot(userId: string): Promise<AuthCredentialSnapshot> {
    const credentials = await this.service.refreshCredentialsIfNeeded(userId);
    const contents = JSON.stringify(credentials);

    return {
      connectionStatus: { connected: true, requiresReauth: false },
      syncToken: await sha256(contents),
      files: [
        {
          path: "/home/sprite/.claude/.credentials.json",
          contents,
          mode: "0600",
        },
      ],
      envVars: {
        CLAUDE_CREDENTIALS_JSON: contents,
      },
    };
  }
}

class OpenAICodexProviderCredentialAdapter implements ProviderCredentialAdapter {
  private readonly service: OpenAICodexAuthService;

  constructor(env: Env, logger: Logger) {
    this.service = new OpenAICodexAuthService(env, logger);
  }

  async getCredentialSnapshot(userId: string): Promise<AuthCredentialSnapshot> {
    const credentials = await this.service.refreshCredentialsIfNeeded(userId);
    const authJson = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: credentials.accessToken,
        ...(credentials.refreshToken ? { refresh_token: credentials.refreshToken } : {}),
        ...(credentials.idToken ? { id_token: credentials.idToken } : {}),
        ...(credentials.expiresAt ? { expires_at: credentials.expiresAt } : {}),
      },
    });

    return {
      connectionStatus: { connected: true, requiresReauth: false },
      syncToken: await sha256(authJson),
      files: [
        {
          path: "/home/sprite/.codex/auth.json",
          contents: authJson,
          mode: "0600",
        },
      ],
      envVars: {
        CODEX_AUTH_JSON: authJson,
      },
    };
  }
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

/**
 * Returns the provider-specific Sprite credential adapter.
 * @param providerId Provider identifier.
 * @param env Worker environment.
 * @param logger Logger for provider service construction.
 * @returns Provider-specific credential adapter.
 */
export function getProviderCredentialAdapter(
  providerId: ProviderId,
  env: Env,
  logger: Logger,
): ProviderCredentialAdapter {
  switch (providerId) {
    case "claude-code":
      return new ClaudeProviderCredentialAdapter(env, logger);
    case "openai-codex":
      return new OpenAICodexProviderCredentialAdapter(env, logger);
    default: {
      const exhaustiveCheck: never = providerId;
      throw new Error(`Unhandled provider: ${exhaustiveCheck}`);
    }
  }
}
