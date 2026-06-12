import { describe, expect, it } from "vitest";
import { AuthService, type AuthGitHubClient } from "../../src/modules/auth/services/auth.service";
import { looksLikeJwt } from "../../src/modules/auth/services/native-access-token.service";
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
    };
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

function createGitHubClient(): AuthGitHubClient {
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
    hasInstallations: async () => true,
  };
}

function createService(db: MockD1): AuthService {
  return new AuthService({
    env: {
      DB: db.asD1(),
      TOKEN_ENCRYPTION_KEY,
      NATIVE_ACCESS_TOKEN_SIGNING_KEY,
      WORKER_URL: "https://api.test",
      WEB_ORIGIN: "https://web.test",
    } as Env,
    github: createGitHubClient(),
  });
}

function seedOauthState(
  db: MockD1,
  state: string,
  redirectOrigin = "https://web.test",
): void {
  db.oauthStates.set(state, {
    state,
    expires_at: "2099-01-01T00:00:00.000Z",
    code_verifier: null,
    redirect_origin: redirectOrigin,
    purpose: "github_login",
    user_id: null,
  });
}

async function exchangeNative(db: MockD1, service: AuthService) {
  seedOauthState(db, "state-native", "cloudecode-dev://auth/callback");
  const result = await service.exchangeNativeGitHubAuthorizationCode({
    code: "code-1",
    state: "state-native",
    requestId: null,
    userAgent: null,
  });
  if (!result.ok) {
    throw new Error("native exchange failed");
  }
  return result.value;
}

describe("AuthService native token refresh", () => {
  it("issues the legacy response shape when client is absent", async () => {
    const db = new MockD1();
    const service = createService(db);
    seedOauthState(db, "state-web");

    const result = await service.exchangeGitHubAuthorizationCode({
      code: "code-1",
      state: "state-web",
      requestId: null,
      userAgent: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    // Pin the legacy shape: no native keys may appear for web clients.
    expect(Object.keys(result.value).sort()).toEqual([
      "hasInstallations",
      "installUrl",
      "token",
      "user",
    ]);
    const sessionTokenHash = await sha256(result.value.token);
    const session = db.authSessions.get(sessionTokenHash);
    expect(sessionTokenHash).not.toBe(result.value.token);
    expect(db.refreshSessions.size).toBe(0);
    // ~30-day expiry
    const ttlMs = new Date(session!.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });

  it("issues a JWT access token and stores only the refresh hash for native clients", async () => {
    const db = new MockD1();
    const service = createService(db);

    const value = await exchangeNative(db, service);

    expect(looksLikeJwt(value.accessToken)).toBe(true);
    expect(value.refreshToken).toBeDefined();
    expect(value.refreshTokenExpiresAt).toBeDefined();
    expect(db.authSessions.size).toBe(0);

    const family = [...db.refreshSessions.values()][0];
    expect(family).toBeDefined();
    expect(family!.refresh_token_hash).toBe(await sha256(value.refreshToken));
    expect(family!.refresh_token_hash).not.toBe(value.refreshToken);
  });

  it("rejects native token exchange for a web-started state", async () => {
    const db = new MockD1();
    const service = createService(db);
    seedOauthState(db, "state-web");

    const result = await service.exchangeNativeGitHubAuthorizationCode({
      code: "code-1",
      state: "state-web",
      requestId: null,
      userAgent: null,
    });

    expect(result.ok).toBe(false);
    expect(db.oauthStates.has("state-web")).toBe(true);
    expect(db.authSessions.size).toBe(0);
    expect(db.refreshSessions.size).toBe(0);
  });

  it("rejects web token exchange for a native-started state", async () => {
    const db = new MockD1();
    const service = createService(db);
    seedOauthState(db, "state-native", "cloudecode-dev://auth/callback");

    const result = await service.exchangeGitHubAuthorizationCode({
      code: "code-1",
      state: "state-native",
      requestId: null,
      userAgent: null,
    });

    expect(result.ok).toBe(false);
    expect(db.oauthStates.has("state-native")).toBe(true);
    expect(db.authSessions.size).toBe(0);
    expect(db.refreshSessions.size).toBe(0);
  });

  it("rotates tokens on refresh without storing native access tokens", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await exchangeNative(db, service);

    const result = await service.refreshSession(issued.refreshToken!);

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
    const issued = await exchangeNative(db, service);

    const first = await service.refreshSession(issued.refreshToken!);
    expect(first.ok).toBe(true);

    // Immediate retry with the rotated-out token (network-retry case).
    const retry = await service.refreshSession(issued.refreshToken!);
    expect(retry.ok).toBe(true);
  });

  it("revokes the whole family on reuse outside the grace window", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await exchangeNative(db, service);

    const first = await service.refreshSession(issued.refreshToken!);
    expect(first.ok).toBe(true);
    if (!first.ok) { return; }

    // Simulate the grace window elapsing.
    const family = [...db.refreshSessions.values()][0]!;
    family.previous_rotated_at = sqliteDatetime(-2 * 60 * 1000);

    const reuse = await service.refreshSession(issued.refreshToken!);
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
    const issued = await exchangeNative(db, service);

    const family = [...db.refreshSessions.values()][0]!;
    family.refresh_expires_at = "2000-01-01T00:00:00.000Z";

    const result = await service.refreshSession(issued.refreshToken!);
    expect(result.ok).toBe(false);
  });

  it("revokes the whole family on native logout", async () => {
    const db = new MockD1();
    const service = createService(db);
    const issued = await exchangeNative(db, service);

    await service.logoutNative(issued.refreshToken);

    expect(db.authSessions.size).toBe(0);
    expect(db.refreshSessions.size).toBe(0);
    const refresh = await service.refreshSession(issued.refreshToken!);
    expect(refresh.ok).toBe(false);
  });

  it("keeps legacy logout behavior for web sessions", async () => {
    const db = new MockD1();
    const service = createService(db);
    seedOauthState(db, "state-web");
    const result = await service.exchangeGitHubAuthorizationCode({
      code: "code-1",
      state: "state-web",
      requestId: null,
      userAgent: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }

    const sessionTokenHash = await sha256(result.value.token);
    await service.logout(result.value.token);
    expect(db.authSessions.has(sessionTokenHash)).toBe(false);
  });
});
