import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../src/modules/auth/services/auth.service";
import { GitHubSignInFlowService } from "../../src/modules/auth/services/github-sign-in-flow.service";
import type { AuthGitHubClient } from "../../src/modules/auth/types/auth.types";
import { validateReturnToPath } from "../../src/modules/auth/utils/return-to.util";
import type { Env } from "../../src/shared/types";

const TOKEN_ENCRYPTION_KEY = btoa("12345678901234567890123456789012");
const requestFields = { requestId: null, userAgent: null };

interface OauthStateRow {
  state: string;
  expires_at: string;
  code_verifier: string | null;
  redirect_origin: string | null;
  purpose: string | null;
  user_id: string | null;
  sign_in_attempt_id: string | null;
}

interface SignInAttemptRow {
  id: string;
  client_type: string;
  claim_token_hash: string;
  status: string;
  user_id: string | null;
  completion_target: string;
  return_to: string | null;
  install_url: string | null;
  expires_at: string;
}

interface UserRow {
  id: string;
  github_id: number;
  github_login: string;
  github_name: string | null;
  github_avatar_url: string | null;
}

/**
 * Minimal stateful D1 fake covering only the tables these flows touch.
 * Rows are matched by SQL fragment, like the other auth service tests.
 */
class MockD1 {
  oauthStates = new Map<string, OauthStateRow>();
  signInAttempts = new Map<string, SignInAttemptRow>();
  users = new Map<number, UserRow>();
  authSessions: { tokenHash: string; userId: string }[] = [];
  refreshSessions: { id: string; userId: string }[] = [];
  githubCredentials: { userId: string }[] = [];

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
      const [state, expiresAt, codeVerifier, redirectOrigin, purpose, userId, attemptId] =
        args as (string | null)[];
      this.oauthStates.set(state as string, {
        state: state as string,
        expires_at: expiresAt as string,
        code_verifier: codeVerifier ?? null,
        redirect_origin: redirectOrigin ?? null,
        purpose: purpose ?? null,
        user_id: userId ?? null,
        sign_in_attempt_id: attemptId ?? null,
      });
      return null;
    }
    if (sql.includes("DELETE FROM oauth_states WHERE datetime(expires_at)")) {
      return this.pruneExpired(this.oauthStates);
    }
    if (sql.includes("FROM oauth_states")) {
      const [state] = args as [string];
      const row = this.oauthStates.get(state);
      if (!row || isExpired(row.expires_at)) {
        return null;
      }
      if (sql.includes("DELETE")) {
        this.oauthStates.delete(state);
      }
      return row;
    }

    if (sql.includes("INSERT INTO sign_in_attempts")) {
      const [id, clientType, claimTokenHash, completionTarget, returnTo, expiresAt] =
        args as (string | null)[];
      this.signInAttempts.set(id as string, {
        id: id as string,
        client_type: clientType as string,
        claim_token_hash: claimTokenHash as string,
        status: "awaiting_oauth",
        user_id: null,
        completion_target: completionTarget as string,
        return_to: returnTo ?? null,
        install_url: null,
        expires_at: expiresAt as string,
      });
      return null;
    }
    if (sql.includes("DELETE FROM sign_in_attempts WHERE datetime(expires_at)")) {
      return this.pruneExpired(this.signInAttempts);
    }
    if (sql.includes("SET status = 'identity_ready'")) {
      const [userId, installUrl, id] = args as (string | null)[];
      const row = this.signInAttempts.get(id as string);
      if (row?.status === "awaiting_oauth") {
        row.status = "identity_ready";
        row.user_id = userId ?? null;
        row.install_url = installUrl ?? null;
      }
      return null;
    }
    if (sql.includes("SET status = 'failed'")) {
      const [id] = args as [string];
      const row = this.signInAttempts.get(id);
      if (row?.status === "awaiting_oauth") {
        row.status = "failed";
      }
      return null;
    }
    if (sql.includes("SET status = 'claimed'")) {
      const [id, claimTokenHash, clientType] = args as [string, string, string];
      const row = this.signInAttempts.get(id);
      if (
        !row
        || row.claim_token_hash !== claimTokenHash
        || row.client_type !== clientType
        || row.status !== "identity_ready"
        || isExpired(row.expires_at)
      ) {
        return null;
      }
      row.status = "claimed";
      return { ...row };
    }
    if (sql.includes("FROM sign_in_attempts")) {
      const [id] = args as [string];
      const row = this.signInAttempts.get(id);
      if (!row || isExpired(row.expires_at)) {
        return null;
      }
      return { ...row };
    }

    if (sql.includes("INSERT INTO users")) {
      const [id, githubId, login, name, avatarUrl] = args as [
        string, number, string, string | null, string | null,
      ];
      const existing = this.users.get(githubId);
      this.users.set(githubId, {
        id: existing?.id ?? id,
        github_id: githubId,
        github_login: login,
        github_name: name,
        github_avatar_url: avatarUrl,
      });
      return null;
    }
    if (sql.includes("FROM users WHERE github_id")) {
      return this.users.get(args[0] as number) ?? null;
    }
    if (sql.includes("FROM users WHERE id")) {
      return [...this.users.values()].find((row) => row.id === args[0]) ?? null;
    }

    if (sql.includes("INSERT INTO user_github_credentials")) {
      this.githubCredentials.push({ userId: args[0] as string });
      return null;
    }
    if (sql.includes("INSERT INTO auth_sessions")) {
      this.authSessions.push({
        tokenHash: args[0] as string,
        userId: args[1] as string,
      });
      return null;
    }
    if (sql.includes("INSERT INTO auth_refresh_sessions")) {
      this.refreshSessions.push({
        id: args[0] as string,
        userId: args[1] as string,
      });
      return null;
    }

    throw new Error(`MockD1: unhandled SQL: ${sql}`);
  }

  private pruneExpired(rows: Map<string, { expires_at: string }>): null {
    for (const [key, row] of rows) {
      if (isExpired(row.expires_at)) {
        rows.delete(key);
      }
    }
    return null;
  }
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

function createEnv(db: MockD1, environment = "development"): Env {
  return {
    DB: db.asD1(),
    TOKEN_ENCRYPTION_KEY,
    NATIVE_ACCESS_TOKEN_SIGNING_KEY: "signing-key-signing-key-signing",
    WORKER_URL: "https://api.test",
    WEB_ORIGIN: "https://web.test",
    ENVIRONMENT: environment,
  } as Env;
}

function createGitHubClient(overrides: Partial<AuthGitHubClient> = {}): AuthGitHubClient {
  return {
    getAuthUrl: (state) => `https://github.test/authorize?state=${state}`,
    getInstallUrl: () => "https://github.test/install",
    exchangeOAuthCode: async () => ({
      accessToken: "gh-access",
      refreshToken: "gh-refresh",
      refreshTokenExpiresAt: undefined,
      expiresAt: undefined,
      user: {
        id: 42,
        login: "octocat",
        name: "Octo Cat",
        avatarUrl: "https://avatars.test/octocat",
      },
    }),
    hasInstallations: async () => true,
    ...overrides,
  };
}

interface Harness {
  db: MockD1;
  flow: GitHubSignInFlowService;
  auth: AuthService;
  clearedUserIds: string[];
}

function createHarness(options: {
  github?: Partial<AuthGitHubClient>;
  environment?: string;
} = {}): Harness {
  const db = new MockD1();
  const clearedUserIds: string[] = [];
  const deps = {
    env: createEnv(db, options.environment),
    github: createGitHubClient(options.github),
    clearRepoListingSync: async (userId: string) => {
      clearedUserIds.push(userId);
    },
  };

  return {
    db,
    clearedUserIds,
    flow: new GitHubSignInFlowService(deps),
    auth: new AuthService(deps),
  };
}

async function startWeb(harness: Harness, returnTo = "/dashboard") {
  const started = await harness.flow.startWeb({
    origin: "https://web.test",
    returnTo,
    ...requestFields,
  });
  if (!started.ok) {
    throw new Error(`web start failed: ${started.error.message}`);
  }
  return started.value;
}

async function startNative(harness: Harness) {
  const started = await harness.flow.startNative({
    redirectUri: "cloudecode-dev://auth/callback",
    ...requestFields,
  });
  if (!started.ok) {
    throw new Error(`native start failed: ${started.error.message}`);
  }
  return started.value;
}

function oauthStateFor(harness: Harness, attemptId: string): string {
  const row = [...harness.db.oauthStates.values()].find(
    (candidate) => candidate.sign_in_attempt_id === attemptId,
  );
  if (!row) {
    throw new Error(`no OAuth state for attempt ${attemptId}`);
  }
  return row.state;
}

async function runOAuthCallback(
  harness: Harness,
  attemptId: string,
  overrides: { code?: string; oauthError?: string } = {},
) {
  return harness.flow.handleOAuthCallback({
    code: overrides.code ?? "code-1",
    oauthError: overrides.oauthError,
    state: oauthStateFor(harness, attemptId),
    ...requestFields,
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("validateReturnToPath", () => {
  it("accepts relative application paths", () => {
    expect(validateReturnToPath("/dashboard")).toEqual({ ok: true, value: "/dashboard" });
    expect(validateReturnToPath("/discord/link?token=abc")).toEqual({
      ok: true,
      value: "/discord/link?token=abc",
    });
  });

  it("rejects anything that could leave this origin", () => {
    for (const value of [
      "https://evil.test/",
      "//evil.test/path",
      "/\\evil.test",
      "\\\\evil.test",
      "javascript:alert(1)",
      "dashboard",
      "",
    ]) {
      expect(validateReturnToPath(value).ok).toBe(false);
    }
  });
});

describe("GitHub sign-in start", () => {
  it("binds client type to the route and stores only the claim-token hash", async () => {
    const harness = createHarness();

    const web = await startWeb(harness);
    const native = await startNative(harness);

    expect(harness.db.signInAttempts.get(web.attemptId)).toMatchObject({
      client_type: "web",
      status: "awaiting_oauth",
      completion_target: "https://web.test",
      return_to: "/dashboard",
    });
    expect(harness.db.signInAttempts.get(native.attemptId)).toMatchObject({
      client_type: "native",
      completion_target: "cloudecode-dev://auth/callback",
      return_to: null,
    });

    const rows = [...harness.db.signInAttempts.values()];
    for (const row of rows) {
      expect(row.claim_token_hash).not.toBe(web.claimToken);
      expect(row.claim_token_hash).not.toBe(native.claimToken);
      expect(row.claim_token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(web.claimToken).not.toBe(native.claimToken);
    expect(web.authorizeUrl).toContain("https://github.test/authorize?state=");
  });

  it("gives web 10 minutes and native 30 minutes", async () => {
    const harness = createHarness();
    const before = Date.now();

    const web = await startWeb(harness);
    const native = await startNative(harness);

    const webTtl = expiryMs(harness, web.attemptId) - before;
    const nativeTtl = expiryMs(harness, native.attemptId) - before;
    expect(webTtl).toBeGreaterThan(9 * 60_000);
    expect(webTtl).toBeLessThanOrEqual(10 * 60_000 + 1_000);
    expect(nativeTtl).toBeGreaterThan(29 * 60_000);
    expect(nativeTtl).toBeLessThanOrEqual(30 * 60_000 + 1_000);
  });

  it("rejects unapproved origins, return paths, and native redirect URIs", async () => {
    const harness = createHarness();

    const badOrigin = await harness.flow.startWeb({
      origin: "https://evil.test",
      returnTo: "/dashboard",
      ...requestFields,
    });
    const badReturnTo = await harness.flow.startWeb({
      origin: "https://web.test",
      returnTo: "https://evil.test",
      ...requestFields,
    });
    const badRedirect = await harness.flow.startNative({
      redirectUri: "evil://auth/callback",
      ...requestFields,
    });

    expect(badOrigin.ok).toBe(false);
    expect(badReturnTo.ok).toBe(false);
    expect(badRedirect.ok).toBe(false);
    expect(harness.db.signInAttempts.size).toBe(0);
  });
});

describe("GitHub sign-in OAuth callback", () => {
  it("consumes the OAuth state once and rejects a replay", async () => {
    const harness = createHarness();
    const attempt = await startWeb(harness);
    const state = oauthStateFor(harness, attempt.attemptId);

    const first = await runOAuthCallback(harness, attempt.attemptId);
    expect(first.ok).toBe(true);
    expect(harness.db.oauthStates.has(state)).toBe(false);

    const replay = await harness.flow.handleOAuthCallback({
      code: "code-1",
      oauthError: undefined,
      state,
      ...requestFields,
    });
    expect(replay.ok).toBe(false);
  });

  it("persists identity and credentials before any session is issued", async () => {
    const harness = createHarness();
    const attempt = await startWeb(harness);

    await runOAuthCallback(harness, attempt.attemptId);

    expect(harness.db.users.size).toBe(1);
    expect(harness.db.githubCredentials).toHaveLength(1);
    expect(harness.db.authSessions).toHaveLength(0);
    expect(harness.db.refreshSessions).toHaveLength(0);
    expect(harness.db.signInAttempts.get(attempt.attemptId)?.status)
      .toBe("identity_ready");
  });

  it("returns a web attempt to its BFF completion route regardless of installation", async () => {
    const withInstall = createHarness();
    const withoutInstall = createHarness({ github: { hasInstallations: async () => false } });
    const a = await startWeb(withInstall);
    const b = await startWeb(withoutInstall);

    const first = await runOAuthCallback(withInstall, a.attemptId);
    const second = await runOAuthCallback(withoutInstall, b.attemptId);

    expect(first).toEqual({
      ok: true,
      value: {
        redirectUrl: `https://web.test/api/auth/github/complete?attemptId=${a.attemptId}`,
      },
    });
    expect(second).toEqual({
      ok: true,
      value: {
        redirectUrl: `https://web.test/api/auth/github/complete?attemptId=${b.attemptId}`,
      },
    });
  });

  it("chains a native attempt through installation only when one is missing", async () => {
    const withInstall = createHarness();
    const withoutInstall = createHarness({ github: { hasInstallations: async () => false } });
    const a = await startNative(withInstall);
    const b = await startNative(withoutInstall);

    const direct = await runOAuthCallback(withInstall, a.attemptId);
    const chained = await runOAuthCallback(withoutInstall, b.attemptId);

    expect(direct).toEqual({
      ok: true,
      value: { redirectUrl: `cloudecode-dev://auth/callback?attemptId=${a.attemptId}` },
    });
    expect(chained.ok).toBe(true);
    if (!chained.ok) { return; }
    expect(chained.value.redirectUrl).toContain("https://github.test/install?state=");
  });

  it("marks the attempt failed and returns the bound client on OAuth denial", async () => {
    const harness = createHarness();
    const web = await startWeb(harness);
    const native = await startNative(harness);

    const webDenied = await runOAuthCallback(harness, web.attemptId, {
      oauthError: "access_denied",
      code: undefined,
    });
    const nativeDenied = await runOAuthCallback(harness, native.attemptId, {
      oauthError: "access_denied",
      code: undefined,
    });

    expect(webDenied).toEqual({
      ok: true,
      value: {
        redirectUrl:
          `https://web.test/api/auth/github/complete?attemptId=${web.attemptId}`
          + "&error=OAUTH_DENIED",
      },
    });
    expect(nativeDenied).toEqual({
      ok: true,
      value: {
        redirectUrl:
          `cloudecode-dev://auth/callback?attemptId=${native.attemptId}&error=OAUTH_DENIED`,
      },
    });
    expect(harness.db.signInAttempts.get(web.attemptId)?.status).toBe("failed");
    expect(harness.db.signInAttempts.get(native.attemptId)?.status).toBe("failed");
  });

  it("does not make the attempt claimable when the code exchange fails", async () => {
    const harness = createHarness({
      github: {
        exchangeOAuthCode: async () => {
          throw new Error("github rejected the code");
        },
      },
    });
    const attempt = await startWeb(harness);

    const result = await runOAuthCallback(harness, attempt.attemptId);

    expect(result.ok).toBe(true);
    expect(harness.db.signInAttempts.get(attempt.attemptId)?.status).toBe("failed");
    const completed = await harness.flow.completeWeb({
      attemptId: attempt.attemptId,
      claimToken: attempt.claimToken,
      ...requestFields,
    });
    expect(completed.ok).toBe(false);
    if (completed.ok) { return; }
    expect(completed.error.code).toBe("INVALID_SIGN_IN_ATTEMPT");
  });

  it("does not extend the attempt deadline on transition", async () => {
    const harness = createHarness();
    const attempt = await startWeb(harness);
    const before = expiryMs(harness, attempt.attemptId);

    await runOAuthCallback(harness, attempt.attemptId);

    expect(expiryMs(harness, attempt.attemptId)).toBe(before);
  });
});

describe("GitHub sign-in completion", () => {
  it("returns only web session data and the server-selected redirect", async () => {
    const harness = createHarness();
    const attempt = await startWeb(harness, "/discord/link?token=abc");
    await runOAuthCallback(harness, attempt.attemptId);

    const result = await harness.flow.completeWeb({
      attemptId: attempt.attemptId,
      claimToken: attempt.claimToken,
      ...requestFields,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.value.redirectUrl).toBe("https://web.test/discord/link?token=abc");
    expect(result.value.user.login).toBe("octocat");
    expect(result.value.token).toBeTypeOf("string");
    expect(result.value).not.toHaveProperty("accessToken");
    expect(result.value).not.toHaveProperty("refreshToken");
    expect(harness.db.authSessions).toHaveLength(1);
  });

  it("selects the installation URL when the web attempt chained one", async () => {
    const harness = createHarness({ github: { hasInstallations: async () => false } });
    const attempt = await startWeb(harness);
    await runOAuthCallback(harness, attempt.attemptId);

    const result = await harness.flow.completeWeb({
      attemptId: attempt.attemptId,
      claimToken: attempt.claimToken,
      ...requestFields,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.value.redirectUrl).toContain("https://github.test/install?state=");
    // The session exists before the browser leaves for GitHub.
    expect(harness.db.authSessions).toHaveLength(1);
  });

  it("returns only a native token pair", async () => {
    const harness = createHarness();
    const attempt = await startNative(harness);
    await runOAuthCallback(harness, attempt.attemptId);

    const result = await harness.flow.completeNative({
      attemptId: attempt.attemptId,
      claimToken: attempt.claimToken,
      ...requestFields,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.value.accessToken.split(".")).toHaveLength(3);
    expect(result.value.refreshToken).toBeTypeOf("string");
    expect(result.value).not.toHaveProperty("token");
    expect(result.value).not.toHaveProperty("redirectUrl");
    expect(harness.db.refreshSessions).toHaveLength(1);
  });

  it("stays claimable while installation is still pending", async () => {
    const harness = createHarness({ github: { hasInstallations: async () => false } });
    const attempt = await startNative(harness);
    await runOAuthCallback(harness, attempt.attemptId);

    const result = await harness.flow.completeNative({
      attemptId: attempt.attemptId,
      claimToken: attempt.claimToken,
      ...requestFields,
    });

    expect(result.ok).toBe(true);
  });

  it("reports SIGN_IN_NOT_READY only for a valid attempt awaiting OAuth", async () => {
    const harness = createHarness();
    const attempt = await startNative(harness);

    const notReady = await harness.flow.completeNative({
      attemptId: attempt.attemptId,
      claimToken: attempt.claimToken,
      ...requestFields,
    });
    const wrongToken = await harness.flow.completeNative({
      attemptId: attempt.attemptId,
      claimToken: "not-the-claim-token",
      ...requestFields,
    });

    expect(notReady.ok).toBe(false);
    if (notReady.ok) { return; }
    expect(notReady.error.code).toBe("SIGN_IN_NOT_READY");
    expect(notReady.error.status).toBe(409);

    // A token mismatch must not disclose that the attempt is merely pending.
    expect(wrongToken.ok).toBe(false);
    if (wrongToken.ok) { return; }
    expect(wrongToken.error.code).toBe("INVALID_SIGN_IN_ATTEMPT");
  });

  it("rejects a completion routed to the other client type", async () => {
    const harness = createHarness();
    const web = await startWeb(harness);
    const native = await startNative(harness);
    await runOAuthCallback(harness, web.attemptId);
    await runOAuthCallback(harness, native.attemptId);

    const webOnNative = await harness.flow.completeNative({
      attemptId: web.attemptId,
      claimToken: web.claimToken,
      ...requestFields,
    });
    const nativeOnWeb = await harness.flow.completeWeb({
      attemptId: native.attemptId,
      claimToken: native.claimToken,
      ...requestFields,
    });

    expect(webOnNative.ok).toBe(false);
    if (webOnNative.ok) { return; }
    expect(webOnNative.error.code).toBe("INVALID_SIGN_IN_ATTEMPT");
    expect(nativeOnWeb.ok).toBe(false);
    expect(harness.db.authSessions).toHaveLength(0);
    expect(harness.db.refreshSessions).toHaveLength(0);
  });

  it("is at-most-once for duplicate and concurrent claims", async () => {
    const harness = createHarness();
    const attempt = await startNative(harness);
    await runOAuthCallback(harness, attempt.attemptId);
    const credentials = {
      attemptId: attempt.attemptId,
      claimToken: attempt.claimToken,
      ...requestFields,
    };

    const [first, second] = await Promise.all([
      harness.flow.completeNative(credentials),
      harness.flow.completeNative(credentials),
    ]);
    const third = await harness.flow.completeNative(credentials);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(third.ok).toBe(false);
    expect(harness.db.refreshSessions).toHaveLength(1);
  });

  it("rejects an expired attempt even after the identity became ready", async () => {
    const harness = createHarness();
    const attempt = await startWeb(harness);
    await runOAuthCallback(harness, attempt.attemptId);
    expireAttempt(harness, attempt.attemptId);

    const result = await harness.flow.completeWeb({
      attemptId: attempt.attemptId,
      claimToken: attempt.claimToken,
      ...requestFields,
    });

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.error.code).toBe("INVALID_SIGN_IN_ATTEMPT");
  });
});

describe("GitHub installation callback", () => {
  it("returns a chained web flow to its stored application route", async () => {
    const harness = createHarness({ github: { hasInstallations: async () => false } });
    const attempt = await startWeb(harness, "/dashboard");
    await runOAuthCallback(harness, attempt.attemptId);
    const state = installStateFor(harness, attempt.attemptId);

    const result = await harness.auth.createGitHubInstallationCallbackRedirect({ state });

    expect(result).toEqual({
      ok: true,
      value: { redirectUrl: "https://web.test/dashboard" },
    });
    expect(harness.clearedUserIds).toHaveLength(1);
  });

  it("keeps a chained web return valid after the sign-in attempt expires", async () => {
    const harness = createHarness({ github: { hasInstallations: async () => false } });
    const attempt = await startWeb(harness, "/dashboard");
    await runOAuthCallback(harness, attempt.attemptId);
    const state = installStateFor(harness, attempt.attemptId);
    expireAttempt(harness, attempt.attemptId);

    const result = await harness.auth.createGitHubInstallationCallbackRedirect({ state });

    expect(result).toEqual({
      ok: true,
      value: { redirectUrl: "https://web.test/dashboard" },
    });
    expect(harness.clearedUserIds).toHaveLength(1);
  });

  it("returns a chained native flow to its custom scheme with the attempt ID", async () => {
    const harness = createHarness({ github: { hasInstallations: async () => false } });
    const attempt = await startNative(harness);
    await runOAuthCallback(harness, attempt.attemptId);
    const state = installStateFor(harness, attempt.attemptId);

    const result = await harness.auth.createGitHubInstallationCallbackRedirect({ state });

    expect(result).toEqual({
      ok: true,
      value: {
        redirectUrl: `cloudecode-dev://auth/callback?attemptId=${attempt.attemptId}`,
      },
    });
  });

  it("rejects a replayed installation state without redirecting again", async () => {
    const harness = createHarness({ github: { hasInstallations: async () => false } });
    const attempt = await startWeb(harness);
    await runOAuthCallback(harness, attempt.attemptId);
    const state = installStateFor(harness, attempt.attemptId);

    await harness.auth.createGitHubInstallationCallbackRedirect({ state });
    const replay = await harness.auth.createGitHubInstallationCallbackRedirect({ state });

    expect(replay.ok).toBe(false);
    expect(harness.clearedUserIds).toHaveLength(1);
  });

  it("ignores browser-supplied installation identifiers", async () => {
    const harness = createHarness({ github: { hasInstallations: async () => false } });
    const attempt = await startWeb(harness);
    await runOAuthCallback(harness, attempt.attemptId);

    // Only the server-issued state is read; setup_action/installation_id are
    // never accepted as authorization evidence.
    const forged = await harness.auth.createGitHubInstallationCallbackRedirect({
      state: "installation_id=999",
    });

    expect(forged.ok).toBe(false);
    expect(harness.clearedUserIds).toHaveLength(0);
  });
});

function expiryMs(harness: Harness, attemptId: string): number {
  const row = harness.db.signInAttempts.get(attemptId);
  if (!row) {
    throw new Error(`no attempt ${attemptId}`);
  }
  return new Date(row.expires_at).getTime();
}

function expireAttempt(harness: Harness, attemptId: string): void {
  const row = harness.db.signInAttempts.get(attemptId);
  if (!row) {
    throw new Error(`no attempt ${attemptId}`);
  }
  row.expires_at = new Date(Date.now() - 1_000).toISOString();
}

function installStateFor(harness: Harness, attemptId: string): string {
  const row = [...harness.db.oauthStates.values()].find(
    (candidate) => candidate.purpose === "github_install"
      && candidate.sign_in_attempt_id === attemptId,
  );
  if (!row) {
    throw new Error(`no installation state for attempt ${attemptId}`);
  }
  return row.state;
}
