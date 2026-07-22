import { describe, expect, it } from "vitest";
import { AuthService } from "../../src/modules/auth/services/auth.service";
import {
  GitHubSignInFlowService,
} from "../../src/modules/auth/services/github-sign-in-flow.service";
import { looksLikeJwt } from "../../src/modules/auth/services/native-access-token.service";
import type { AuthGitHubClient } from "../../src/modules/auth/types/auth.types";
import { sha256 } from "../../src/shared/utils/crypto";
import type { Env } from "../../src/shared/types";

const TOKEN_ENCRYPTION_KEY = btoa("12345678901234567890123456789012");
const NATIVE_ACCESS_TOKEN_SIGNING_KEY = "native-access-token-test-signing-key";

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

interface AuthSessionRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
}

interface RefreshSessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  previous_refresh_token_hash: string | null;
  previous_rotated_at: string | null;
  refresh_expires_at: string;
}

/** sqlite datetime('now') format: "YYYY-MM-DD HH:MM:SS" (UTC). */
function sqliteDatetime(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Stateful in-memory D1 fake covering the SQL issued by AuthService and its
 * repositories, including `batch` (the mock pattern from
 * user-session.service.test.ts, extended with state + batch support).
 */
class MockD1 {
  oauthStates = new Map<string, OauthStateRow>();
  signInAttempts = new Map<string, SignInAttemptRow>();
  users = new Map<number, UserRow>();
  authSessions = new Map<string, AuthSessionRow>();
  refreshSessions = new Map<string, RefreshSessionRow>();
  credentialUserIds = new Set<string>();

  asD1(): D1Database {
    return {
      prepare: (sql: string) => this.prepareStatement(sql),
      batch: async (statements: Array<{ run(): Promise<unknown> }>) => {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        return results;
      },
    } as unknown as D1Database;
  }

  private prepareStatement(sql: string) {
    const execute = (args: unknown[]): unknown => this.execute(sql, args);
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          execute(args);
          return { success: true };
        },
        first: async () => execute(args),
      }),
      run: async () => {
        execute([]);
        return { success: true };
      },
    };
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
      return null;
    }
    if (sql.includes("INSERT INTO sign_in_attempts")) {
      const [id, clientType, claimTokenHash, completionTarget, returnTo, expiresAt] = args as [
        string, string, string, string, string | null, string,
      ];
      this.signInAttempts.set(id, {
        id,
        client_type: clientType,
        claim_token_hash: claimTokenHash,
        status: "awaiting_oauth",
        user_id: null,
        completion_target: completionTarget,
        return_to: returnTo,
        install_url: null,
        expires_at: expiresAt,
      });
      return null;
    }
    if (sql.includes("DELETE FROM sign_in_attempts")) {
      return null;
    }
    if (sql.includes("SET status = 'identity_ready'")) {
      const [userId, installUrl, id] = args as [string, string | null, string];
      const attempt = this.signInAttempts.get(id);
      if (attempt) {
        attempt.status = "identity_ready";
        attempt.user_id = userId;
        attempt.install_url = installUrl;
      }
      return null;
    }
    if (sql.includes("SET status = 'claimed'")) {
      const [id] = args as [string];
      const attempt = this.signInAttempts.get(id);
      if (!attempt || attempt.status !== "identity_ready") {
        return null;
      }
      attempt.status = "claimed";
      return { ...attempt };
    }
    if (sql.includes("FROM sign_in_attempts")) {
      const [id] = args as [string];
      return this.signInAttempts.get(id) ?? null;
    }
    if (sql.includes("DELETE FROM oauth_states")) {
      const [state] = args as [string];
      const row = this.oauthStates.get(state);
      if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
        return null;
      }
      this.oauthStates.delete(state);
      return row;
    }
    if (sql.includes("FROM oauth_states")) {
      const [state] = args as [string];
      const row = this.oauthStates.get(state);
      if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
        return null;
      }
      return row;
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
      const [githubId] = args as [number];
      return this.users.get(githubId) ?? null;
    }
    if (sql.includes("FROM users WHERE id")) {
      const [userId] = args as [string];
      return [...this.users.values()].find((user) => user.id === userId) ?? null;
    }
    if (sql.includes("INSERT INTO user_github_credentials")) {
      const [userId] = args as [string];
      this.credentialUserIds.add(userId);
      return null;
    }
    if (sql.includes("INSERT INTO auth_refresh_sessions")) {
      const [id, userId, refreshTokenHash, refreshExpiresAt] = args as [
        string, string, string, string,
      ];
      this.refreshSessions.set(id, {
        id,
        user_id: userId,
        refresh_token_hash: refreshTokenHash,
        previous_refresh_token_hash: null,
        previous_rotated_at: null,
        refresh_expires_at: refreshExpiresAt,
      });
      return null;
    }
    if (sql.includes("UPDATE auth_refresh_sessions")) {
      const [newHash, previousHash, refreshExpiresAt, id] = args as [
        string, string, string, string,
      ];
      const row = this.refreshSessions.get(id);
      if (row) {
        row.refresh_token_hash = newHash;
        row.previous_refresh_token_hash = previousHash;
        row.previous_rotated_at = sqliteDatetime();
        row.refresh_expires_at = refreshExpiresAt;
      }
      return null;
    }
    if (sql.includes("DELETE FROM auth_refresh_sessions WHERE id")) {
      const [id] = args as [string];
      this.refreshSessions.delete(id);
      return null;
    }
    if (sql.includes("FROM auth_refresh_sessions")) {
      const [hash] = args as [string];
      for (const row of this.refreshSessions.values()) {
        if (row.refresh_token_hash === hash || row.previous_refresh_token_hash === hash) {
          // The real query normalizes previous_rotated_at to ISO via strftime.
          return {
            ...row,
            previous_rotated_at: row.previous_rotated_at
              ? `${row.previous_rotated_at.replace(" ", "T")}Z`
              : null,
          };
        }
      }
      return null;
    }
    if (sql.includes("INSERT INTO auth_sessions")) {
      const [tokenHash, userId, expiresAt] = args as [string, string, string];
      this.authSessions.set(tokenHash, {
        token_hash: tokenHash,
        user_id: userId,
        expires_at: expiresAt,
      });
      return null;
    }
    if (
      sql.includes("DELETE FROM auth_sessions")
      && sql.includes("token_hash = ?")
    ) {
      const [tokenHash] = args as [string];
      this.authSessions.delete(tokenHash);
      return null;
    }
    throw new Error(`MockD1: unhandled SQL: ${sql}`);
  }
}

function createGitHubClient(hasInstallations = true): AuthGitHubClient {
  return {
    getAuthUrl: () => "https://github.test/authorize",
    getInstallUrl: () => "https://github.test/install",
    exchangeOAuthCode: async () => ({
      accessToken: "gh-access-token",
      refreshToken: "gh-refresh-token",
      refreshTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: { id: 123, login: "octocat", name: "Octo Cat", avatarUrl: "https://a" },
    }),
    hasInstallations: async () => hasInstallations,
  };
}

function createDeps(db: MockD1, hasInstallations = true) {
  return {
    env: {
      DB: db.asD1(),
      TOKEN_ENCRYPTION_KEY,
      NATIVE_ACCESS_TOKEN_SIGNING_KEY,
      WORKER_URL: "https://api.test",
      WEB_ORIGIN: "https://web.test",
      ENVIRONMENT: "development",
    } as Env,
    github: createGitHubClient(hasInstallations),
    clearRepoListingSync: async () => {},
  };
}

function createService(db: MockD1, hasInstallations = true): AuthService {
  return new AuthService(createDeps(db, hasInstallations));
}

const requestFields = { requestId: null, userAgent: null };

/** Runs a full native sign-in so refresh/logout start from a real session. */
async function signInNative(db: MockD1, hasInstallations = true) {
  const flow = new GitHubSignInFlowService(createDeps(db, hasInstallations));
  const started = await flow.startNative({
    redirectUri: "cloudecode-dev://auth/callback",
    ...requestFields,
  });
  if (!started.ok) {
    throw new Error("native sign-in start failed");
  }
  const state = [...db.oauthStates.values()]
    .find((row) => row.sign_in_attempt_id === started.value.attemptId)?.state;
  if (!state) {
    throw new Error("no OAuth state for the native attempt");
  }
  const callback = await flow.handleOAuthCallback({
    code: "code-1",
    oauthError: undefined,
    state,
    ...requestFields,
  });
  if (!callback.ok) {
    throw new Error("native OAuth callback failed");
  }
  const completed = await flow.completeNative({
    attemptId: started.value.attemptId,
    claimToken: started.value.claimToken,
    ...requestFields,
  });
  if (!completed.ok) {
    throw new Error("native sign-in completion failed");
  }
  return completed.value;
}

/** Runs a full web sign-in so web-session behavior starts from a real session. */
async function signInWeb(db: MockD1) {
  const flow = new GitHubSignInFlowService(createDeps(db));
  const started = await flow.startWeb({
    origin: "https://web.test",
    returnTo: "/dashboard",
    ...requestFields,
  });
  if (!started.ok) {
    throw new Error("web sign-in start failed");
  }
  const state = [...db.oauthStates.values()]
    .find((row) => row.sign_in_attempt_id === started.value.attemptId)?.state;
  if (!state) {
    throw new Error("no OAuth state for the web attempt");
  }
  await flow.handleOAuthCallback({
    code: "code-1",
    oauthError: undefined,
    state,
    ...requestFields,
  });
  const completed = await flow.completeWeb({
    attemptId: started.value.attemptId,
    claimToken: started.value.claimToken,
    ...requestFields,
  });
  if (!completed.ok) {
    throw new Error("web sign-in completion failed");
  }
  return completed.value;
}

describe("AuthService native session lifecycle", () => {
  it("issues a JWT access token and stores only the refresh hash", async () => {
    const db = new MockD1();

    const value = await signInNative(db);

    expect(looksLikeJwt(value.accessToken)).toBe(true);
    expect(value.refreshTokenExpiresAt).toBeDefined();
    expect(db.authSessions.size).toBe(0);

    const family = [...db.refreshSessions.values()][0];
    expect(family).toBeDefined();
    expect(family!.refresh_token_hash).toBe(await sha256(value.refreshToken));
    expect(family!.refresh_token_hash).not.toBe(value.refreshToken);
  });

  it("issues a hashed 30-day opaque web session with no native fields", async () => {
    const db = new MockD1();

    const value = await signInWeb(db);

    expect(Object.keys(value).sort()).toEqual(["redirectUrl", "token", "user"]);
    const sessionTokenHash = await sha256(value.token);
    const session = db.authSessions.get(sessionTokenHash);
    expect(sessionTokenHash).not.toBe(value.token);
    expect(db.refreshSessions.size).toBe(0);
    const ttlMs = new Date(session!.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });

  it("rotates tokens on refresh without storing native access tokens", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await signInNative(db);

    const result = await service.refreshSession(issued.refreshToken);

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.value.accessToken).not.toBe(issued.accessToken);
    expect(result.value.refreshToken).not.toBe(issued.refreshToken);
    expect(looksLikeJwt(result.value.accessToken)).toBe(true);
    expect(db.authSessions.size).toBe(0);
  });

  it("accepts the previous refresh token within the grace window", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await signInNative(db);

    const first = await service.refreshSession(issued.refreshToken);
    expect(first.ok).toBe(true);

    // Immediate retry with the rotated-out token (network-retry case).
    const retry = await service.refreshSession(issued.refreshToken);
    expect(retry.ok).toBe(true);
  });

  it("revokes the whole family on reuse outside the grace window", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await signInNative(db);

    const first = await service.refreshSession(issued.refreshToken);
    expect(first.ok).toBe(true);
    if (!first.ok) { return; }

    // Simulate the grace window elapsing.
    const family = [...db.refreshSessions.values()][0]!;
    family.previous_rotated_at = sqliteDatetime(-2 * 60 * 1000);

    const reuse = await service.refreshSession(issued.refreshToken);
    expect(reuse.ok).toBe(false);
    if (reuse.ok) { return; }
    expect(reuse.error.status).toBe(401);
    expect(reuse.error.code).toBe("INVALID_REFRESH_TOKEN");

    // Family fully revoked: the current refresh token dies too.
    expect(db.refreshSessions.size).toBe(0);
    const current = await service.refreshSession(first.value.refreshToken);
    expect(current.ok).toBe(false);
  });

  it("rejects unknown refresh tokens", async () => {
    const db = new MockD1();
    const service = createService(db);

    const result = await service.refreshSession("not-a-real-token");

    expect(result.ok).toBe(false);
    if (result.ok) { return; }
    expect(result.error.status).toBe(401);
    expect(result.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects expired refresh tokens", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await signInNative(db);

    const family = [...db.refreshSessions.values()][0]!;
    family.refresh_expires_at = "2000-01-01T00:00:00.000Z";

    const result = await service.refreshSession(issued.refreshToken);
    expect(result.ok).toBe(false);
  });

  it("revokes the whole family on native logout", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await signInNative(db);

    await service.logoutNative(issued.refreshToken);

    expect(db.authSessions.size).toBe(0);
    expect(db.refreshSessions.size).toBe(0);
    const refresh = await service.refreshSession(issued.refreshToken);
    expect(refresh.ok).toBe(false);
  });

  it("keeps web logout scoped to the opaque web session row", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await signInWeb(db);

    const sessionTokenHash = await sha256(issued.token);
    await service.logout(issued.token);
    expect(db.authSessions.has(sessionTokenHash)).toBe(false);
  });
});
