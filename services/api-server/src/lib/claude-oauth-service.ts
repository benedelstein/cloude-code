import type { Logger } from "@repo/shared";
import { decrypt, encrypt } from "@/lib/crypto";
import { logger as defaultLogger } from "@/lib/logger";
import {
  ClaudeSessionRepository,
  type ClaudeSessionRecord,
} from "@/repositories/claude-session-repository";
import { OauthStateRepository } from "@/repositories/oauth-state-repository";
import type { Env } from "@/types";
import { computeCodeChallenge, generateCodeVerifier } from "@/lib/pkce";

const loggerName = "claude-oauth-service.ts";
const CLAUDE_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export const DEFAULT_CLAUDE_SCOPES = [
  "org:create_api_key",
  "user:inference",
  "user:mcp_servers",
  "user:profile",
  "user:sessions:claude_code",
];
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_AUTH_URL = "https://claude.ai/oauth/authorize";
export const CLAUDE_OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
export const CLAUDE_OAUTH_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";

export type ClaudeOAuthErrorCode =
  | "CLAUDE_INVALID_STATE"
  | "CLAUDE_INVALID_CODE"
  | "CLAUDE_AUTH_REQUIRED"
  | "CLAUDE_REAUTH_REQUIRED"
  | "CLAUDE_TOKEN_EXCHANGE_FAILED"
  | "CLAUDE_TOKEN_REFRESH_FAILED";

export class ClaudeOAuthError extends Error {
  readonly code: ClaudeOAuthErrorCode;
  readonly status: number;

  constructor(
    code: ClaudeOAuthErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "ClaudeOAuthError";
    this.code = code;
    this.status = status;
  }
}

type ClaudeTokenPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string | null;
  rateLimitTier: string | null;
};

type TokenPayloadFallback = {
  scopes: string[];
  subscriptionType: string | null;
  rateLimitTier: string | null;
};

type TokenEndpointErrorPayload = {
  error?: string;
  error_description?: string;
};

export type ClaudeConnectionStatus = {
  connected: boolean;
  requiresReauth: boolean;
  subscriptionType: string | null;
  rateLimitTier: string | null;
};

export type ClaudeCredentials = {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
};

export type ClaudeAuthorizationUrlResult = {
  url: string;
  state: string;
};

export function stringifyClaudeCredentials(
  credentials: ClaudeCredentials,
): string {
  return JSON.stringify(credentials);
}

export function getClaudeCredentialFingerprint(
  credentials: ClaudeCredentials,
): string {
  return JSON.stringify({
    accessToken: credentials.claudeAiOauth.accessToken,
    refreshToken: credentials.claudeAiOauth.refreshToken,
  });
}

function toClaudeCredentials(credentials: ClaudeTokenPayload): ClaudeCredentials {
  return {
    claudeAiOauth: {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt,
      scopes: credentials.scopes,
      subscriptionType: credentials.subscriptionType ?? "unknown",
      rateLimitTier: credentials.rateLimitTier ?? "default",
    },
  };
}

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === "string");
  }
  if (typeof value === "string") {
    return value.split(" ").map((scope) => scope.trim()).filter(Boolean);
  }
  return [];
}

function parseStoredScopes(scopesJson: string): string[] {
  try {
    const parsed = JSON.parse(scopesJson);
    return Array.isArray(parsed)
      ? parsed.filter((scope): scope is string => typeof scope === "string")
      : [];
  } catch {
    return [];
  }
}

function parseTokenPayload(
  payload: unknown,
  fallback?: TokenPayloadFallback,
): ClaudeTokenPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Claude token payload");
  }

  const raw = payload as Record<string, unknown>;
  const accessToken = raw.access_token;
  const refreshToken = raw.refresh_token;
  const expiresIn = raw.expires_in;

  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn)
  ) {
    throw new Error("Claude token response missing required fields");
  }

  const scopes = parseScopes(raw.scope);
  const subscriptionType = typeof raw.subscription_type === "string"
    ? raw.subscription_type
    : (fallback?.subscriptionType ?? null);
  const rateLimitTier = typeof raw.rate_limit_tier === "string"
    ? raw.rate_limit_tier
    : (fallback?.rateLimitTier ?? null);

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: scopes.length > 0 ? scopes : (fallback?.scopes ?? DEFAULT_CLAUDE_SCOPES),
    subscriptionType,
    rateLimitTier,
  };
}

function needsRefresh(expiresAt: number): boolean {
  return !Number.isFinite(expiresAt) || (expiresAt - Date.now()) <= CLAUDE_REFRESH_BUFFER_MS;
}

export class ClaudeOAuthService {
  private readonly claudeSessionRepository: ClaudeSessionRepository;
  private readonly oauthStateRepository: OauthStateRepository;
  private readonly logger: Logger;

  constructor(
    private readonly env: Env,
    logger: Logger = defaultLogger,
  ) {
    this.claudeSessionRepository = new ClaudeSessionRepository(env.DB);
    this.oauthStateRepository = new OauthStateRepository(env.DB);
    this.logger = logger;
  }

  /**
   * Create a claude oauth authorization url for a user to authorize the app to access their claude account
   * @returns the authorization url and state for the user to authorize the app to access their claude account
   */
  async createAuthorizationUrl(): Promise<ClaudeAuthorizationUrlResult> {
    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await computeCodeChallenge(codeVerifier);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await this.oauthStateRepository.create(state, expiresAt, codeVerifier);

    const params = new URLSearchParams({
      code: "true",
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      response_type: "code",
      redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
      scope: DEFAULT_CLAUDE_SCOPES.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    return {
      url: `${CLAUDE_OAUTH_AUTH_URL}?${params.toString()}`,
      state,
    };
  }

  /**
   * Exchange a claude oauth authorization code for access and refresh tokens
   * @param params the parameters for the exchange
   */
  async exchangeAuthorizationCode(params: {
    userId: string;
    code: string;
    state: string;
  }): Promise<void> {
    const [rawCodePart, rawStatePart] = params.code.split("#");
    const authorizationCode = rawCodePart?.trim() ?? "";
    const pastedState = rawStatePart?.trim();
    if (!authorizationCode) {
      throw new ClaudeOAuthError(
        "CLAUDE_INVALID_CODE",
        "Missing authorization code",
        400,
      );
    }
    if (pastedState && pastedState !== params.state) {
      throw new ClaudeOAuthError(
        "CLAUDE_INVALID_STATE",
        "State mismatch in pasted code",
        400,
      );
    }

    const stateRow = await this.oauthStateRepository.consumeValid(params.state);
    if (!stateRow?.codeVerifier) {
      throw new ClaudeOAuthError(
        "CLAUDE_INVALID_STATE",
        "Invalid or expired state",
        400,
      );
    }

    let payload: unknown;
    try {
      payload = await this.postTokenRequest({
        grant_type: "authorization_code",
        code: authorizationCode,
        state: params.state,
        redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
        code_verifier: stateRow.codeVerifier,
      });
    } catch (error) {
      if (error instanceof ClaudeOAuthError) {
        throw error;
      }
      this.logger.error("Claude token exchange error", { loggerName, error });
      throw new ClaudeOAuthError(
        "CLAUDE_TOKEN_EXCHANGE_FAILED",
        "Failed to exchange Claude OAuth code.",
        400,
      );
    }

    const credentials = parseTokenPayload(payload);
    await this.persistTokens(params.userId, credentials);
  }

  async disconnect(userId: string): Promise<void> {
    await this.claudeSessionRepository.deleteByUserId(userId);
  }

  /**
   * Get the valid credentials for a user, refreshing the access token if it is expired
   * @param userId the user id to get the credentials for
   * @returns the typed credentials object that can be written to a .credentials.json file for the vm-agent
   */
  async getValidCredentials(userId: string): Promise<ClaudeCredentials> {
    const credentials = await this.loadValidCredentials(userId);
    return toClaudeCredentials(credentials);
  }

  /**
   * Get the valid credentials for a user, refreshing the access token if it is expired
   * @param userId the user id to get the credentials for
   * @returns stringified json that can be written to a .credentials.json file for the vm-agent
   */
  async getValidCredentialsJson(userId: string): Promise<string> {
    const credentials = await this.getValidCredentials(userId);
    return stringifyClaudeCredentials(credentials);
  }

  /**
   * Get the claude oauth connection status for a user. Will refresh the access token if it is expired, and if refresh fails, returns unauthenticated state
   * @param userId the user id to get the connection status for
   * @returns the connection status for the user
   */
  async getConnectionStatus(userId: string): Promise<ClaudeConnectionStatus> {
    const row = await this.claudeSessionRepository.getSessionByUserId(userId);
    if (!row) {
      return {
        connected: false,
        requiresReauth: false,
        subscriptionType: null,
        rateLimitTier: null,
      };
    }

    if (row.requiresReauth) {
      return {
        connected: false,
        requiresReauth: true,
        subscriptionType: row.subscriptionType,
        rateLimitTier: row.rateLimitTier,
      };
    }

    try {
      const credentials = await this.loadValidCredentials(userId, row);
      return {
        connected: true,
        requiresReauth: false,
        subscriptionType: credentials.subscriptionType,
        rateLimitTier: credentials.rateLimitTier,
      };
    } catch (error) {
      if (error instanceof ClaudeOAuthError) {
        if (error.code === "CLAUDE_REAUTH_REQUIRED") {
          return {
            connected: false,
            requiresReauth: true,
            subscriptionType: row.subscriptionType,
            rateLimitTier: row.rateLimitTier,
          };
        }
        if (error.code === "CLAUDE_AUTH_REQUIRED") {
          return {
            connected: false,
            requiresReauth: false,
            subscriptionType: null,
            rateLimitTier: null,
          };
        }
      }

      this.logger.error("Failed to determine Claude connection status", {
        loggerName,
        error,
        fields: { userId },
      });
      return {
        connected: false,
        requiresReauth: false,
        subscriptionType: row.subscriptionType,
        rateLimitTier: row.rateLimitTier,
      };
    }
  }

  private async loadValidCredentials(
    userId: string,
    existingRow?: ClaudeSessionRecord,
  ): Promise<ClaudeTokenPayload> {
    const row = existingRow ?? await this.claudeSessionRepository.getSessionByUserId(userId);
    if (!row) {
      throw new ClaudeOAuthError(
        "CLAUDE_AUTH_REQUIRED",
        "Claude authentication required. Connect Claude before creating a session.",
        401,
      );
    }

    if (row.requiresReauth) {
      throw new ClaudeOAuthError(
        "CLAUDE_REAUTH_REQUIRED",
        "Claude authentication expired. Reconnect Claude before creating a session.",
        401,
      );
    }

    if (needsRefresh(row.expiresAtMs)) {
      return this.refreshStoredTokens(userId, row);
    }

    return {
      accessToken: await decrypt(row.encryptedAccessToken, this.env.TOKEN_ENCRYPTION_KEY),
      refreshToken: await decrypt(row.encryptedRefreshToken, this.env.TOKEN_ENCRYPTION_KEY),
      expiresAt: row.expiresAtMs,
      scopes: parseStoredScopes(row.scopesJson),
      subscriptionType: row.subscriptionType,
      rateLimitTier: row.rateLimitTier,
    };
  }

  private async refreshStoredTokens(
    userId: string,
    row: ClaudeSessionRecord,
  ): Promise<ClaudeTokenPayload> {
    const refreshToken = await decrypt(row.encryptedRefreshToken, this.env.TOKEN_ENCRYPTION_KEY);
    let payload: unknown;

    try {
      payload = await this.postTokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      });
    } catch (error) {
      this.logger.error("Error refreshing Claude tokens", { error });
      if (error instanceof ClaudeOAuthError && error.code === "CLAUDE_REAUTH_REQUIRED") {
        await this.claudeSessionRepository.markRequiresReauth(userId);
      }
      throw error;
    }

    const credentials = parseTokenPayload(payload, {
      scopes: parseStoredScopes(row.scopesJson),
      subscriptionType: row.subscriptionType,
      rateLimitTier: row.rateLimitTier,
    });
    this.logger.info("successfully refreshed Claude tokens", { loggerName, fields: { userId } });
    await this.persistTokens(userId, credentials);
    return credentials;
  }

  private async persistTokens(
    userId: string,
    credentials: ClaudeTokenPayload,
  ): Promise<void> {
    const encryptedAccessToken = await encrypt(
      credentials.accessToken,
      this.env.TOKEN_ENCRYPTION_KEY,
    );
    const encryptedRefreshToken = await encrypt(
      credentials.refreshToken,
      this.env.TOKEN_ENCRYPTION_KEY,
    );

    await this.claudeSessionRepository.upsertClaudeSession({
      userId,
      encryptedAccessToken,
      encryptedRefreshToken,
      expiresAtMs: credentials.expiresAt,
      scopesJson: JSON.stringify(credentials.scopes),
      subscriptionType: credentials.subscriptionType,
      rateLimitTier: credentials.rateLimitTier,
    });
  }

  private async postTokenRequest(body: Record<string, string>): Promise<unknown> {
    const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json();
    }

    const rawText = await response.text();
    let errorPayload: TokenEndpointErrorPayload | null;
    try {
      errorPayload = JSON.parse(rawText) as TokenEndpointErrorPayload;
    } catch {
      errorPayload = null;
    }

    const errorCode = errorPayload?.error;
    const errorDescription = errorPayload?.error_description;
    if (errorCode === "invalid_grant") {
      throw new ClaudeOAuthError(
        "CLAUDE_REAUTH_REQUIRED",
        errorDescription ?? "Claude authentication expired. Reconnect Claude.",
        401,
      );
    }

    throw new ClaudeOAuthError(
      body.grant_type === "authorization_code"
        ? "CLAUDE_TOKEN_EXCHANGE_FAILED"
        : "CLAUDE_TOKEN_REFRESH_FAILED",
      errorDescription ?? "Claude token request failed.",
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }
}
