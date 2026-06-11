import { describe, expect, it } from "vitest";
import { AuthService, type AuthGitHubClient } from "../../src/modules/auth/services/auth.service";
import { validateNativeRedirectUri } from "../../src/modules/auth/utils/native-redirect.util";
import type { Env } from "../../src/shared/types";

const TOKEN_ENCRYPTION_KEY = btoa("12345678901234567890123456789012");

interface OauthStateRow {
  state: string;
  expires_at: string;
  code_verifier: string | null;
  redirect_origin: string | null;
  purpose: string | null;
  user_id: string | null;
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
      }),
    } as unknown as D1Database;
  }

  private execute(sql: string, args: unknown[]): unknown {
    if (sql.includes("INSERT INTO oauth_states")) {
      const [state, expiresAt, codeVerifier, redirectOrigin, purpose, userId] = args as [
        string, string, string | null, string | null, string | null, string | null,
      ];
      this.oauthStates.set(state, {
        state,
        expires_at: expiresAt,
        code_verifier: codeVerifier,
        redirect_origin: redirectOrigin,
        purpose,
        user_id: userId,
      });
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

function createService(db: MockD1, environment = "development"): AuthService {
  return new AuthService({
    env: {
      DB: db.asD1(),
      TOKEN_ENCRYPTION_KEY,
      WEB_ORIGIN: "https://web.test",
      ENVIRONMENT: environment,
    } as Env,
    github: createGitHubClient(),
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

describe("AuthService native OAuth redirect", () => {
  it("stores the native redirect URI on the state row", async () => {
    const db = new MockD1();
    const service = createService(db);

    const result = await service.createGitHubAuthorizationUrl({
      nativeRedirectUri: "cloudecode-dev://auth/callback",
      ...requestFields,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    const row = db.oauthStates.get(result.value.state);
    expect(row?.redirect_origin).toBe("cloudecode-dev://auth/callback");
    expect(row?.purpose).toBe("github_login");
  });

  it("rejects a redirect URI that is not allowlisted", async () => {
    const service = createService(new MockD1());

    const result = await service.createGitHubAuthorizationUrl({
      nativeRedirectUri: "evil://auth/callback",
      ...requestFields,
    });

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.error.status).toBe(400);
  });

  it("rejects the dev redirect URI in production", async () => {
    const service = createService(new MockD1(), "production");

    const result = await service.createGitHubAuthorizationUrl({
      nativeRedirectUri: "cloudecode-dev://auth/callback",
      ...requestFields,
    });

    expect(result.ok).toBe(false);
  });

  it("302s the callback to the custom scheme with code and state", async () => {
    const db = new MockD1();
    const service = createService(db);
    const started = await service.createGitHubAuthorizationUrl({
      nativeRedirectUri: "cloudecode-dev://auth/callback",
      ...requestFields,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) { return; }

    const result = await service.createGitHubCallbackRedirect({
      code: "code-1",
      state: started.value.state,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.value.redirectUrl).toBe(
      `cloudecode-dev://auth/callback?code=code-1&state=${started.value.state}`,
    );
    // Callback peeks; the state must survive for /auth/token to consume.
    expect(db.oauthStates.has(started.value.state)).toBe(true);
  });

  it("keeps the web callback redirect unchanged when no redirect URI is used", async () => {
    const db = new MockD1();
    const service = createService(db);
    const started = await service.createGitHubAuthorizationUrl({
      requestedOrigin: "https://web.test",
      ...requestFields,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) { return; }

    const result = await service.createGitHubCallbackRedirect({
      code: "code-1",
      state: started.value.state,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.value.redirectUrl).toBe(
      `https://web.test/api/auth/finalize?code=code-1&state=${started.value.state}`,
    );
  });
});
