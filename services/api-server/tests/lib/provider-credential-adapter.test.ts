import { describe, expect, it, vi, afterEach } from "vitest";
import { success, type Logger } from "@repo/shared";
import { OpenAICodexAuthService } from "../../src/lib/providers/openai-codex-auth-service";
import { getProviderCredentialAdapter } from "../../src/lib/providers/provider-credential-adapter";
import type { Env } from "../../src/types";

function createLogger(): Logger {
  return {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    scope() {
      return this;
    },
  };
}

function createEnv(): Env {
  return {
    DB: {} as D1Database,
    TOKEN_ENCRYPTION_KEY: btoa("12345678901234567890123456789012"),
  } as Env;
}

function createJwt(payload: Record<string, unknown>): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `header.${encodedPayload}.signature`;
}

describe("OpenAICodexProviderCredentialAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes auth.json in the Codex chatgpt token format using the id token account id", async () => {
    const refreshCredentialsIfNeededSpy = vi
      .spyOn(OpenAICodexAuthService.prototype, "refreshCredentialsIfNeeded")
      .mockResolvedValue(success({
        accessToken: createJwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "account-from-access-token",
          },
        }),
        refreshToken: "refresh-token-123",
        idToken: createJwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "account-from-id-token",
          },
        }),
        expiresAt: "2099-01-01T00:00:00.000Z",
      }));

    const adapter = getProviderCredentialAdapter("openai-codex", createEnv(), createLogger());
    const result = await adapter.getCredentialSnapshot("user-1");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(refreshCredentialsIfNeededSpy).toHaveBeenCalledWith("user-1");
    expect(result.value.files).toHaveLength(1);
    expect(result.value.files[0]?.path).toBe("/home/sprite/.codex/auth.json");

    const authJson = JSON.parse(result.value.files[0]!.contents) as {
      auth_mode: string;
      OPENAI_API_KEY: null;
      tokens: {
        id_token: string;
        access_token: string;
        refresh_token: string;
        account_id: string;
        expires_at?: string;
      };
      last_refresh: string;
    };

    expect(authJson.auth_mode).toBe("chatgpt");
    expect(authJson.OPENAI_API_KEY).toBeNull();
    expect(authJson.tokens).toEqual({
      id_token: expect.any(String),
      access_token: expect.any(String),
      refresh_token: "refresh-token-123",
      account_id: "account-from-id-token",
    });
    expect(authJson.tokens.expires_at).toBeUndefined();
    expect(authJson.last_refresh).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.value.envVars.CODEX_AUTH_JSON).toBe(result.value.files[0]!.contents);
  });

  it("fails when the id token does not carry the canonical account claim", async () => {
    vi.spyOn(OpenAICodexAuthService.prototype, "refreshCredentialsIfNeeded")
      .mockResolvedValue(success({
        accessToken: createJwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "account-from-access-token",
          },
        }),
        refreshToken: "refresh-token-123",
        idToken: createJwt({ sub: "user-1" }),
        expiresAt: "2099-01-01T00:00:00.000Z",
      }));

    const adapter = getProviderCredentialAdapter("openai-codex", createEnv(), createLogger());
    const result = await adapter.getCredentialSnapshot("user-1");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("SYNC_FAILED");
    expect(result.error.message).toBe("OpenAI Codex ID token did not include chatgpt_account_id.");
  });
});
