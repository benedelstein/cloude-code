import { Logger, ProviderId, DomainError, Result, success, failure } from "@repo/shared";
import { ClaudeOAuthService } from "./claude-oauth-service";
import { sha256 } from "@/lib/utils/crypto";
import { OpenAICodexAuthService } from "./openai-codex-auth-service";
import { Env } from "@/types";
import { ProviderConnectionStatus } from "./connection-status";

const PROVIDER_CREDENTIAL_DOMAIN = "provider_credential";

export type ProviderCredentialError =
  | DomainError<typeof PROVIDER_CREDENTIAL_DOMAIN, "AUTH_REQUIRED" | "REAUTH_REQUIRED", { provider: ProviderId }>
  | DomainError<typeof PROVIDER_CREDENTIAL_DOMAIN, "SYNC_FAILED", { provider: ProviderId }>;

function providerCredentialError<Code extends ProviderCredentialError["code"]>(
  code: Code,
  provider: ProviderId,
  message: string,
  extra?: Record<string, unknown>,
): Extract<ProviderCredentialError, { code: Code }> {
  return { domain: PROVIDER_CREDENTIAL_DOMAIN, code, message, provider, ...extra } as Extract<ProviderCredentialError, { code: Code }>;
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
  /* eslint-disable-next-line no-unused-vars */
  getCredentialSnapshot(_userId: string): Promise<Result<AuthCredentialSnapshot, ProviderCredentialError>>;
}

class ClaudeProviderCredentialAdapter implements ProviderCredentialAdapter {
  private readonly service: ClaudeOAuthService;

  constructor(env: Env, logger: Logger) {
    this.service = new ClaudeOAuthService(env, logger);
  }

  async getCredentialSnapshot(userId: string): Promise<Result<AuthCredentialSnapshot, ProviderCredentialError>> {
    const result = await this.service.refreshCredentialsIfNeeded(userId);
    if (!result.ok) {
      switch (result.error.code) {
        case "CLAUDE_AUTH_REQUIRED":
          return failure(providerCredentialError("AUTH_REQUIRED", "claude-code", result.error.message));
        case "CLAUDE_REAUTH_REQUIRED":
          return failure(providerCredentialError("REAUTH_REQUIRED", "claude-code", result.error.message));
        default:
          return failure(providerCredentialError("SYNC_FAILED", "claude-code", result.error.message));
      }
    }
    const contents = JSON.stringify(result.value);
    return success({
      connectionStatus: { connected: true, requiresReauth: false },
      syncToken: await sha256(contents),
      files: [{ path: "/home/sprite/.claude/.credentials.json", contents, mode: "0600" }],
      envVars: { CLAUDE_CREDENTIALS_JSON: contents },
    });
  }
}

class OpenAICodexProviderCredentialAdapter implements ProviderCredentialAdapter {
  private readonly service: OpenAICodexAuthService;

  constructor(env: Env, logger: Logger) {
    this.service = new OpenAICodexAuthService(env, logger);
  }

  async getCredentialSnapshot(userId: string): Promise<Result<AuthCredentialSnapshot, ProviderCredentialError>> {
    const result = await this.service.refreshCredentialsIfNeeded(userId);
    if (!result.ok) {
      switch (result.error.code) {
        case "OPENAI_CODEX_AUTH_REQUIRED":
          return failure(providerCredentialError("AUTH_REQUIRED", "openai-codex", result.error.message));
        case "OPENAI_CODEX_REAUTH_REQUIRED":
          return failure(providerCredentialError("REAUTH_REQUIRED", "openai-codex", result.error.message));
        default:
          return failure(providerCredentialError("SYNC_FAILED", "openai-codex", result.error.message));
      }
    }
    const credentials = result.value;
    const authJson = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: credentials.accessToken,
        ...(credentials.refreshToken ? { refresh_token: credentials.refreshToken } : {}),
        ...(credentials.idToken ? { id_token: credentials.idToken } : {}),
        ...(credentials.expiresAt ? { expires_at: credentials.expiresAt } : {}),
      },
    });
    return success({
      connectionStatus: { connected: true, requiresReauth: false },
      syncToken: await sha256(authJson),
      files: [{ path: "/home/sprite/.codex/auth.json", contents: authJson, mode: "0600" }],
      envVars: { CODEX_AUTH_JSON: authJson },
    });
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
