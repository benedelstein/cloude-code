import { describe, expect, it } from "vitest";
import { AuthService, type AuthGitHubClient } from "../../src/modules/auth/services/auth.service";
import {
  nativeInstallRedirectUri,
  validateNativeInstallRedirectUri,
  validateNativeRedirectUri,
} from "../../src/modules/auth/utils/native-redirect.util";
import type { Env } from "../../src/shared/types";

const TOKEN_ENCRYPTION_KEY = btoa("12345678901234567890123456789012");

interface OauthStateRow {
  state: string;
  expires_at: string;
  code_verifier: string | null;
  redirect_origin: string | null;
  purpose: string | null;
  user_id: string | null;
  sign_in_attempt_id: string | null;
}

/** Minimal stateful D1 fake: only the oauth_states SQL these flows touch. */
class MockD1 {
  oauthStates = new Map<string, OauthStateRow>();

  asD1(): D1Database {
    return {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            this.execute(sql, args);
            return { success: true };
          },
          first: async () => this.execute(sql, args),
        }),
        run: async () => {
          this.execute(sql, []);
          return { success: true };
        },
      }),
    } as unknown as D1Database;
  }

  private execute(sql: string, args: unknown[]): unknown {
    if (sql.includes("INSERT INTO oauth_states")) {
      const [
        state, expiresAt, codeVerifier, redirectOrigin, purpose, userId, signInAttemptId,
      ] = args as [
        string, string, string | null, string | null,
        string | null, string | null, string | null,
      ];
      this.oauthStates.set(state, {
        state,
        expires_at: expiresAt,
        code_verifier: codeVerifier,
        redirect_origin: redirectOrigin,
        purpose,
        user_id: userId,
        sign_in_attempt_id: signInAttemptId,
      });
      return null;
    }
    if (sql.includes("DELETE FROM oauth_states WHERE datetime(expires_at)")) {
      for (const [key, row] of this.oauthStates) {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          this.oauthStates.delete(key);
        }
      }
      return null;
    }
    if (sql.includes("FROM oauth_states")) {
      const [state] = args as [string];
      const row = this.oauthStates.get(state);
      if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
        return null;
      }
      if (sql.includes("DELETE")) {
        this.oauthStates.delete(state);
      }
      return row;
    }
    throw new Error(`MockD1: unhandled SQL: ${sql}`);
  }
}

function createGitHubClient(): AuthGitHubClient {
  return {
    getAuthUrl: (state) => `https://github.test/authorize?state=${state}`,
    getInstallUrl: () => "https://github.test/install",
    exchangeOAuthCode: async () => {
      throw new Error("unused");
    },
    hasInstallations: async () => true,
  };
}

function createService(
  db: MockD1,
  environment = "development",
  clearRepoListingSync: (userId: string) => Promise<void> = async () => {},
): AuthService {
  return new AuthService({
    env: {
      DB: db.asD1(),
      TOKEN_ENCRYPTION_KEY,
      WEB_ORIGIN: "https://web.test",
      ENVIRONMENT: environment,
    } as Env,
    github: createGitHubClient(),
    clearRepoListingSync,
  });
}

const requestFields = { requestId: null, userAgent: null };

describe("validateNativeRedirectUri", () => {
  const env = (environment: string) => ({ ENVIRONMENT: environment } as Env);

  it("accepts the production URI in any environment", () => {
    expect(validateNativeRedirectUri("cloudecode://auth/callback", env("production")).ok).toBe(true);
    expect(validateNativeRedirectUri("cloudecode://auth/callback", env("development")).ok).toBe(true);
  });

  it("accepts the dev URI only outside production", () => {
    expect(validateNativeRedirectUri("cloudecode-dev://auth/callback", env("development")).ok).toBe(true);
    expect(validateNativeRedirectUri("cloudecode-dev://auth/callback", env("production")).ok).toBe(false);
  });

  it("rejects unknown URIs, including near-misses", () => {
    for (const uri of [
      "evil://auth/callback",
      "cloudecode://auth/callback?x=1",
      "cloudecode://other",
      "https://web.test",
      "",
    ]) {
      expect(validateNativeRedirectUri(uri, env("development")).ok).toBe(false);
    }
  });
});

describe("native GitHub installation redirect", () => {
  const env = (environment: string) => ({ ENVIRONMENT: environment } as Env);

  it("pairs production and development OAuth callbacks with installation callbacks", () => {
    expect(nativeInstallRedirectUri("cloudecode://auth/callback", env("production"))).toEqual({
      ok: true,
      value: "cloudecode://github/install/complete",
    });
    expect(nativeInstallRedirectUri("cloudecode-dev://auth/callback", env("development"))).toEqual({
      ok: true,
      value: "cloudecode-dev://github/install/complete",
    });
  });

  it("accepts the development installation callback only outside production", () => {
    expect(
      validateNativeInstallRedirectUri(
        "cloudecode-dev://github/install/complete",
        env("development"),
      ).ok,
    ).toBe(true);
    expect(
      validateNativeInstallRedirectUri(
        "cloudecode-dev://github/install/complete",
        env("production"),
      ).ok,
    ).toBe(false);
  });

  it("creates a stateful install URL and consumes it on callback", async () => {
    const db = new MockD1();
    const clearedUserIds: string[] = [];
    const service = createService(db, "development", async (userId) => {
      clearedUserIds.push(userId);
    });
    const started = await service.createGitHubInstallationUrl({
      userId: "user-1",
      nativeRedirectUri: "cloudecode-dev://auth/callback",
      ...requestFields,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) { return; }
    expect(started.value.url).toBe(
      `https://github.test/install?state=${started.value.state}`,
    );
    expect(db.oauthStates.get(started.value.state)).toMatchObject({
      purpose: "github_install",
      redirect_origin: "cloudecode-dev://github/install/complete",
      user_id: "user-1",
    });

    const callback = await service.createGitHubInstallationCallbackRedirect({
      state: started.value.state,
    });
    expect(callback).toEqual({
      ok: true,
      value: {
        redirectUrl:
          `cloudecode-dev://github/install/complete?state=${started.value.state}`,
      },
    });
    expect(db.oauthStates.has(started.value.state)).toBe(false);
    expect(clearedUserIds).toEqual(["user-1"]);

    const repeatedCallback = await service.createGitHubInstallationCallbackRedirect({
      state: started.value.state,
    });
    expect(repeatedCallback.ok).toBe(false);
    expect(clearedUserIds).toEqual(["user-1"]);
  });
});
