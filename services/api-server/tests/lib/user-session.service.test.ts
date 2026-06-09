import { describe, expect, it, vi } from "vitest";
import { UserSessionService } from "../../src/modules/auth/services/user-session.service";
import { encrypt } from "../../src/shared/utils/crypto";
import type { Env } from "../../src/shared/types";
import type { RefreshedToken } from "../../src/shared/types/github";

const TOKEN_ENCRYPTION_KEY = btoa("12345678901234567890123456789012");

interface CredentialsRow {
  encrypted_access_token: string;
  access_token_expires_at: string | null;
  encrypted_refresh_token: string | null;
  refresh_token_expires_at: string | null;
}

async function createEncryptedCredentials(params: {
  accessToken?: string;
  accessTokenExpiresAt?: string | null;
  refreshToken?: string | null;
} = {}): Promise<CredentialsRow> {
  return {
    encrypted_access_token: await encrypt(params.accessToken ?? "old-access-token", TOKEN_ENCRYPTION_KEY),
    access_token_expires_at: params.accessTokenExpiresAt ?? "2000-01-01T00:00:00.000Z",
    encrypted_refresh_token: params.refreshToken === null
      ? null
      : await encrypt(params.refreshToken ?? "refresh-token", TOKEN_ENCRYPTION_KEY),
    refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
  };
}

function createEnv(credentialsRow: CredentialsRow | null): Env {
  const database = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes("FROM user_github_credentials")) {
            return credentialsRow;
          }
          return null;
        }),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
  } as unknown as D1Database;

  return {
    DB: database,
    TOKEN_ENCRYPTION_KEY,
  } as Env;
}

function createRefreshProvider(refreshUserToken: () => Promise<RefreshedToken>) {
  return {
    refreshUserToken: vi.fn(refreshUserToken),
  };
}

describe("UserSessionService GitHub credentials", () => {
  it("returns a valid stored access token without refreshing", async () => {
    const refreshProvider = createRefreshProvider(async () => ({
      accessToken: "new-token",
      refreshToken: "new-refresh-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    }));
    const service = new UserSessionService({
      env: createEnv(await createEncryptedCredentials({
        accessToken: "valid-token",
        accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      })),
      githubTokenRefreshProvider: refreshProvider,
    });

    const result = await service.getValidGitHubCredentialByUserId("user-1");

    expect(result).toEqual({
      ok: true,
      value: { accessToken: "valid-token" },
    });
    expect(refreshProvider.refreshUserToken).not.toHaveBeenCalled();
  });

  it("returns auth required when credentials are missing", async () => {
    const service = new UserSessionService({
      env: createEnv(null),
      githubTokenRefreshProvider: createRefreshProvider(async () => {
        throw new Error("unused");
      }),
    });

    const result = await service.getValidGitHubCredentialByUserId("user-1");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "GITHUB_AUTH_REQUIRED",
        status: 401,
        message: "Reconnect GitHub to continue.",
      },
    });
  });

  it("returns auth required when the refresh token is rejected", async () => {
    const error = new Error("bad refresh token") as Error & { status: number };
    error.status = 400;
    const service = new UserSessionService({
      env: createEnv(await createEncryptedCredentials()),
      githubTokenRefreshProvider: createRefreshProvider(async () => {
        throw error;
      }),
    });

    const result = await service.getValidGitHubCredentialByUserId("user-1");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "GITHUB_AUTH_REQUIRED",
        status: 401,
        message: "Reconnect GitHub to continue.",
      },
    });
  });

  it("returns unavailable when GitHub refresh fails transiently", async () => {
    const service = new UserSessionService({
      env: createEnv(await createEncryptedCredentials()),
      githubTokenRefreshProvider: createRefreshProvider(async () => {
        throw new Error("network down");
      }),
    });

    const result = await service.getValidGitHubCredentialByUserId("user-1");

    expect(result).toEqual({
      ok: false,
      error: {
        code: "GITHUB_UNAVAILABLE",
        status: 503,
        message: "GitHub is unavailable. Try again shortly.",
      },
    });
  });
});
