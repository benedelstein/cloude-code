import type { AuthMethod, Logger } from "@repo/shared";
import { decrypt, encrypt } from "@/lib/utils/crypto";
import { createLogger } from "@/lib/logger";
import { readStoredCredentialJson } from "@/lib/crypto";
import { ProviderAuthAttemptRepository } from "@/repositories/provider-auth-attempt-repository";
import { UserProviderCredentialRepository } from "@/repositories/user-provider-credential-repository";
import type { Env } from "@/types";

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
const OPENAI_CODEX_AUTH_METHOD: AuthMethod = "oauth";
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_DEVICE_AUTH_URL = "https://auth.openai.com/oauth/device/code";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_SCOPES = "openid profile email offline_access";
const OPENAI_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type OpenAICodexErrorCode =
  | "OPENAI_CODEX_INVALID_STATE"
  | "OPENAI_CODEX_INVALID_CODE"
  | "OPENAI_CODEX_AUTH_REQUIRED"
  | "OPENAI_CODEX_REAUTH_REQUIRED"
  | "OPENAI_CODEX_TOKEN_EXCHANGE_FAILED"
  | "OPENAI_CODEX_TOKEN_REFRESH_FAILED";

export class OpenAICodexAuthError extends Error {
  readonly code: OpenAICodexErrorCode;
  readonly status: number;

  constructor(code: OpenAICodexErrorCode, message: string, status: number) {
    super(message);
    this.name = "OpenAICodexAuthError";
    this.code = code;
    this.status = status;
  }
}

export type OpenAICodexAuthorizationUrlResult = {
  url: string;
  state: string;
};

export type OpenAICodexDeviceAuthorizationResult = {
  attemptId: string;
  verificationUrl: string;
  userCode: string;
  intervalSeconds: number;
  expiresAt: string;
};

export type OpenAICodexDeviceAuthorizationStatus =
  | { status: "pending" }
  | { status: "completed" }
  | { status: "expired" };

export type OpenAICodexConnectionStatus = {
  connected: boolean;
  requiresReauth: boolean;
};

export type OpenAICodexCredentials = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: string | null;
};

type OpenAICodexCredentialPayload = OpenAICodexCredentials;

type OpenAICodexTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type OpenAICodexDeviceAuthorizationResponse = {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
};

type OpenAICodexDeviceAttemptContext = {
  deviceCode: string;
  intervalSeconds: number;
  verificationUrl: string;
  userCode: string;
};

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT");
  }
  const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(payload));
}

function deriveExpiryIsoString(
  accessToken: string,
  expiresInSeconds?: number,
): string | null {
  if (typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds)) {
    return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  }

  try {
    const payload = decodeJwtPayload(accessToken);
    if (typeof payload.exp === "number") {
      return new Date(payload.exp * 1000).toISOString();
    }
  } catch {
    return null;
  }

  return null;
}

function needsRefresh(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return (expiresAtMs - Date.now()) <= OPENAI_REFRESH_BUFFER_MS;
}

function parseStoredCredentials(decryptedJson: string): OpenAICodexCredentialPayload {
  return JSON.parse(decryptedJson) as OpenAICodexCredentialPayload;
}

export class OpenAICodexAuthService {
  private readonly providerAuthAttemptRepository: ProviderAuthAttemptRepository;
  private readonly userProviderCredentialRepository: UserProviderCredentialRepository;
  private readonly logger: Logger;

  constructor(
    private readonly env: Env,
    logger: Logger = createLogger("openai-codex-auth-service.ts"),
  ) {
    this.providerAuthAttemptRepository = new ProviderAuthAttemptRepository(env.DB);
    this.userProviderCredentialRepository = new UserProviderCredentialRepository(env.DB);
    this.logger = logger.scope("openai-codex-auth-service.ts");
  }

  /**
   * Starts a device authorization attempt for OpenAI Codex.
   * @param userId Authenticated user id.
   * @returns Device authorization instructions and polling metadata.
   */
  async startDeviceAuthorization(
    userId: string,
  ): Promise<OpenAICodexDeviceAuthorizationResult> {
    const response = await fetch(OPENAI_DEVICE_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: OPENAI_CLIENT_ID,
        scope: OPENAI_SCOPES,
      }),
    });

    const rawText = await response.text();
    let payload: OpenAICodexDeviceAuthorizationResponse;
    try {
      payload = JSON.parse(rawText) as OpenAICodexDeviceAuthorizationResponse;
    } catch {
      payload = {};
    }

    if (
      !response.ok ||
      typeof payload.device_code !== "string" ||
      typeof payload.user_code !== "string" ||
      typeof payload.verification_uri !== "string" ||
      typeof payload.expires_in !== "number"
    ) {
      throw new OpenAICodexAuthError(
        "OPENAI_CODEX_TOKEN_EXCHANGE_FAILED",
        payload.error_description ?? "Failed to start OpenAI Codex device authorization.",
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    }

    const attemptId = crypto.randomUUID();
    const intervalSeconds = typeof payload.interval === "number" && payload.interval > 0
      ? payload.interval
      : 5;
    const expiresAt = new Date(Date.now() + payload.expires_in * 1000).toISOString();
    const context: OpenAICodexDeviceAttemptContext = {
      deviceCode: payload.device_code,
      intervalSeconds,
      verificationUrl: payload.verification_uri_complete ?? payload.verification_uri,
      userCode: payload.user_code,
    };

    await this.providerAuthAttemptRepository.upsert({
      id: attemptId,
      userId,
      providerId: OPENAI_CODEX_PROVIDER_ID,
      authMethod: OPENAI_CODEX_AUTH_METHOD,
      flowType: "device_code",
      encryptedContextJson: await encrypt(
        JSON.stringify(context),
        this.env.TOKEN_ENCRYPTION_KEY,
      ),
      expiresAt,
    });

    return {
      attemptId,
      verificationUrl: context.verificationUrl,
      userCode: context.userCode,
      intervalSeconds,
      expiresAt,
    };
  }

  /**
   * Polls a device authorization attempt and completes it when the user approves.
   * @param userId Authenticated user id.
   * @param attemptId Stored attempt id.
   * @returns Current attempt status.
   */
  async pollDeviceAuthorization(
    userId: string,
    attemptId: string,
  ): Promise<OpenAICodexDeviceAuthorizationStatus> {
    const attempt = await this.providerAuthAttemptRepository.getByIdAndUserId(
      attemptId,
      userId,
    );
    if (!attempt) {
      return { status: "expired" };
    }

    if (Date.parse(attempt.expiresAt) <= Date.now()) {
      await this.providerAuthAttemptRepository.deleteById(attemptId);
      return { status: "expired" };
    }

    const context = JSON.parse(
      await decrypt(attempt.encryptedContextJson, this.env.TOKEN_ENCRYPTION_KEY),
    ) as OpenAICodexDeviceAttemptContext;

    let tokenData: OpenAICodexTokenResponse;
    try {
      tokenData = await this.postTokenRequest(
        new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: context.deviceCode,
          client_id: OPENAI_CLIENT_ID,
        }),
        "device_code",
      );
    } catch (error) {
      if (
        error instanceof OpenAICodexAuthError &&
        (error.message.includes("authorization_pending") || error.message.includes("slow_down"))
      ) {
        return { status: "pending" };
      }

      if (
        error instanceof OpenAICodexAuthError &&
        (
          error.message.includes("expired_token") ||
          error.message.includes("access_denied") ||
          error.code === "OPENAI_CODEX_REAUTH_REQUIRED"
        )
      ) {
        await this.providerAuthAttemptRepository.deleteById(attemptId);
        return { status: "expired" };
      }

      throw error;
    }

    const credentials = this.parseTokenResponse(tokenData, null);
    await this.persistCredentials(userId, credentials);
    await this.providerAuthAttemptRepository.deleteById(attemptId);
    return { status: "completed" };
  }

  /**
   * Exchanges an authorization code for OpenAI Codex credentials and stores them.
   * @deprecated Web product flow should use device authorization, not localhost callbacks.
   */
  async exchangeAuthorizationCode(): Promise<void> {
    throw new OpenAICodexAuthError(
      "OPENAI_CODEX_INVALID_CODE",
      "Browser callback auth is not supported for the web product. Use device code auth.",
      400,
    );
  }

  /**
   * Returns provider connection status, refreshing credentials when needed.
   * @param userId Authenticated user id.
   * @returns Connection status for OpenAI Codex.
   */
  async getConnectionStatus(userId: string): Promise<OpenAICodexConnectionStatus> {
    const record = await this.userProviderCredentialRepository.getByUserProviderAndMethod(
      userId,
      OPENAI_CODEX_PROVIDER_ID,
      OPENAI_CODEX_AUTH_METHOD,
    );
    if (!record) {
      return { connected: false, requiresReauth: false };
    }
    if (record.requiresReauth) {
      return { connected: false, requiresReauth: true };
    }

    try {
      await this.refreshCredentialsIfNeeded(userId);
      return { connected: true, requiresReauth: false };
    } catch (error) {
      if (error instanceof OpenAICodexAuthError) {
        if (error.code === "OPENAI_CODEX_REAUTH_REQUIRED") {
          return { connected: false, requiresReauth: true };
        }
        if (error.code === "OPENAI_CODEX_AUTH_REQUIRED") {
          return { connected: false, requiresReauth: false };
        }
      }

      this.logger.error("Failed to determine OpenAI Codex connection status", {
        error,
        fields: { userId },
      });
      return { connected: false, requiresReauth: false };
    }
  }

  /**
   * Deletes stored OpenAI Codex credentials for a user.
   * @param userId Authenticated user id.
   */
  async disconnect(userId: string): Promise<void> {
    await this.userProviderCredentialRepository.deleteByUserAndProvider(
      userId,
      OPENAI_CODEX_PROVIDER_ID,
    );
  }

  /**
   * Returns valid OpenAI Codex credentials, refreshing them when needed.
   * @param userId Authenticated user id.
   * @returns Current valid credentials.
   */
  async getValidCredentials(userId: string): Promise<OpenAICodexCredentials> {
    return this.refreshCredentialsIfNeeded(userId);
  }

  /**
   * Refreshes OpenAI Codex credentials if they are close to expiry.
   * @param userId Authenticated user id.
   * @returns Current valid credentials.
   */
  async refreshCredentialsIfNeeded(userId: string): Promise<OpenAICodexCredentials> {
    const record = await this.userProviderCredentialRepository.getByUserProviderAndMethod(
      userId,
      OPENAI_CODEX_PROVIDER_ID,
      OPENAI_CODEX_AUTH_METHOD,
    );
    if (!record) {
      throw new OpenAICodexAuthError(
        "OPENAI_CODEX_AUTH_REQUIRED",
        "OpenAI Codex authentication required.",
        401,
      );
    }
    if (record.requiresReauth) {
      throw new OpenAICodexAuthError(
        "OPENAI_CODEX_REAUTH_REQUIRED",
        "OpenAI Codex authentication expired. Reconnect OpenAI Codex.",
        401,
      );
    }

    const decryptedJson = await readStoredCredentialJson(
      record.encryptedCredentials,
      this.env.TOKEN_ENCRYPTION_KEY,
    );
    const credentials = parseStoredCredentials(decryptedJson);

    if (!needsRefresh(credentials.expiresAt)) {
      return credentials;
    }

    if (!credentials.refreshToken) {
      await this.userProviderCredentialRepository.markRequiresReauth(
        userId,
        OPENAI_CODEX_PROVIDER_ID,
        OPENAI_CODEX_AUTH_METHOD,
      );
      throw new OpenAICodexAuthError(
        "OPENAI_CODEX_REAUTH_REQUIRED",
        "OpenAI Codex refresh token is unavailable. Reconnect OpenAI Codex.",
        401,
      );
    }

    let tokenData: OpenAICodexTokenResponse;
    try {
      tokenData = await this.postTokenRequest(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: OPENAI_CLIENT_ID,
        }),
        "refresh_token",
      );
    } catch (error) {
      if (
        error instanceof OpenAICodexAuthError &&
        error.code === "OPENAI_CODEX_REAUTH_REQUIRED"
      ) {
        await this.userProviderCredentialRepository.markRequiresReauth(
          userId,
          OPENAI_CODEX_PROVIDER_ID,
          OPENAI_CODEX_AUTH_METHOD,
        );
      }
      throw error;
    }

    const refreshedCredentials = this.parseTokenResponse(tokenData, credentials);
    await this.persistCredentials(userId, refreshedCredentials);
    return refreshedCredentials;
  }

  private parseTokenResponse(
    tokenData: OpenAICodexTokenResponse,
    fallback: OpenAICodexCredentials | null,
  ): OpenAICodexCredentials {
    if (typeof tokenData.access_token !== "string") {
      throw new OpenAICodexAuthError(
        "OPENAI_CODEX_TOKEN_EXCHANGE_FAILED",
        "OpenAI Codex token response did not include an access token.",
        400,
      );
    }

    return {
      accessToken: tokenData.access_token,
      refreshToken: typeof tokenData.refresh_token === "string"
        ? tokenData.refresh_token
        : (fallback?.refreshToken ?? null),
      idToken: typeof tokenData.id_token === "string"
        ? tokenData.id_token
        : (fallback?.idToken ?? null),
      expiresAt: deriveExpiryIsoString(tokenData.access_token, tokenData.expires_in)
        ?? fallback?.expiresAt
        ?? null,
    };
  }

  private async persistCredentials(
    userId: string,
    credentials: OpenAICodexCredentials,
  ): Promise<void> {
    const encryptedCredentials = await encrypt(
      JSON.stringify(credentials),
      this.env.TOKEN_ENCRYPTION_KEY,
    );

    await this.userProviderCredentialRepository.upsert({
      userId,
      providerId: OPENAI_CODEX_PROVIDER_ID,
      authMethod: OPENAI_CODEX_AUTH_METHOD,
      encryptedCredentials,
      requiresReauth: false,
    });
  }


  private async postTokenRequest(
    body: URLSearchParams,
      grantType: "authorization_code" | "refresh_token" | "device_code",
  ): Promise<OpenAICodexTokenResponse> {
    let response: Response;
    try {
      response = await fetch(OPENAI_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error) {
      this.logger.error("OpenAI Codex token request failed", { error });
      throw new OpenAICodexAuthError(
        grantType === "authorization_code"
          ? "OPENAI_CODEX_TOKEN_EXCHANGE_FAILED"
          : "OPENAI_CODEX_TOKEN_REFRESH_FAILED",
        "Failed to contact OpenAI Codex auth endpoint.",
        502,
      );
    }

    const rawText = await response.text();
    let tokenData: OpenAICodexTokenResponse;
    try {
      tokenData = JSON.parse(rawText) as OpenAICodexTokenResponse;
    } catch {
      tokenData = {};
    }

    if (response.ok) {
      return tokenData;
    }

    const errorDescription = tokenData.error_description ?? "OpenAI Codex token request failed.";
    const authErrorCode = tokenData.error;
    if (authErrorCode === "authorization_pending" || authErrorCode === "slow_down") {
      throw new OpenAICodexAuthError(
        "OPENAI_CODEX_TOKEN_EXCHANGE_FAILED",
        authErrorCode,
        400,
      );
    }
    if (authErrorCode === "expired_token" || authErrorCode === "access_denied") {
      throw new OpenAICodexAuthError(
        "OPENAI_CODEX_REAUTH_REQUIRED",
        authErrorCode,
        401,
      );
    }
    if (authErrorCode === "invalid_grant" || response.status === 401) {
      throw new OpenAICodexAuthError(
        "OPENAI_CODEX_REAUTH_REQUIRED",
        errorDescription,
        401,
      );
    }

    throw new OpenAICodexAuthError(
      grantType === "authorization_code"
        ? "OPENAI_CODEX_TOKEN_EXCHANGE_FAILED"
        : "OPENAI_CODEX_TOKEN_REFRESH_FAILED",
      errorDescription,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }
}
