import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  authenticateBearerToken,
  type AuthenticateSession,
  createAuthMiddleware,
} from "../../src/modules/auth/middleware/auth.middleware";
import { NativeAccessTokenService } from "../../src/modules/auth/services/native-access-token.service";
import type { AuthUser } from "../../src/modules/auth/types/auth.types";
import type { Env } from "../../src/shared/types";

const testUser: AuthUser = {
  id: "user-1",
  githubId: 123,
  githubLogin: "ben",
  githubName: "Ben",
  githubAvatarUrl: null,
};

const testUserRow = {
  id: testUser.id,
  github_id: testUser.githubId,
  github_login: testUser.githubLogin,
  github_name: testUser.githubName,
  github_avatar_url: testUser.githubAvatarUrl,
};

function createApp(authenticate: AuthenticateSession) {
  const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
  app.use("*", createAuthMiddleware(authenticate));
  app.get("/me", (c) => c.json({ userId: c.get("user").id }));
  return app;
}

function createDefaultApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
  app.use("*", createAuthMiddleware());
  app.get("/me", (c) => c.json({ userId: c.get("user").id }));
  return app;
}

function request(
  app: ReturnType<typeof createApp> | ReturnType<typeof createDefaultApp>,
  init: RequestInit = {},
  env = {} as Env,
) {
  return app.fetch(new Request("http://test/me", init), env);
}

describe("createAuthMiddleware", () => {
  it("rejects requests without a bearer token", async () => {
    const authenticate = vi.fn<AuthenticateSession>();
    const response = await request(createApp(authenticate));

    expect(response.status).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects invalid session tokens", async () => {
    const authenticate = vi.fn<AuthenticateSession>(async () => null);
    const response = await request(createApp(authenticate), {
      headers: { Authorization: "Bearer bad-token" },
    });

    expect(response.status).toBe(401);
    expect(authenticate).toHaveBeenCalledWith(
      expect.anything(),
      "bad-token",
    );
  });

  it("stores the authenticated user for downstream handlers", async () => {
    const authenticate = vi.fn<AuthenticateSession>(async () => testUser);
    const response = await request(createApp(authenticate), {
      headers: { Authorization: "Bearer good-token" },
    });

    await expect(response.json()).resolves.toEqual({ userId: "user-1" });
    expect(response.status).toBe(200);
  });

  it("accepts a valid native JWT by loading the user row without a D1 session lookup", async () => {
    const prepare = vi.fn((sql: string) => {
      expect(sql).toContain("FROM users");
      expect(sql).not.toContain("auth_sessions");
      return {
        bind: (userId: string) => {
          expect(userId).toBe("user-1");
          return { first: async () => testUserRow };
        },
      };
    });
    const env = {
      WORKER_URL: "https://api.test",
      NATIVE_ACCESS_TOKEN_SIGNING_KEY: "native-access-token-test-signing-key",
      DB: { prepare },
    } as unknown as Env;
    const token = await new NativeAccessTokenService(env).sign({
      refreshSessionId: "refresh-session-1",
      userId: testUser.id,
    });

    const response = await request(createDefaultApp(), {
      headers: { Authorization: `Bearer ${token}` },
    }, env);

    await expect(response.json()).resolves.toEqual({ userId: "user-1" });
    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid native JWT before using a custom opaque-session fallback", async () => {
    const env = {
      WORKER_URL: "https://api.test",
      NATIVE_ACCESS_TOKEN_SIGNING_KEY: "native-access-token-test-signing-key",
    } as unknown as Env;
    const token = await new NativeAccessTokenService(env).sign({
      refreshSessionId: "refresh-session-1",
      userId: testUser.id,
    });
    const authenticateOpaqueSession = vi.fn<AuthenticateSession>(
      async () => null,
    );
    const authenticateUserById = vi.fn(async () => testUser);

    const user = await authenticateBearerToken(
      env,
      token,
      authenticateOpaqueSession,
      authenticateUserById,
    );

    expect(user).toEqual(testUser);
    expect(authenticateOpaqueSession).not.toHaveBeenCalled();
    expect(authenticateUserById).toHaveBeenCalledWith(env, "user-1");
  });

  it("rejects malformed JWT-shaped tokens without falling back to D1", async () => {
    const env = {
      WORKER_URL: "https://api.test",
      NATIVE_ACCESS_TOKEN_SIGNING_KEY: "native-access-token-test-signing-key",
      DB: {
        prepare: () => {
          throw new Error("D1 must not be used for malformed JWT auth");
        },
      },
    } as unknown as Env;

    const response = await request(createDefaultApp(), {
      headers: { Authorization: "Bearer not.a.jwt" },
    }, env);

    expect(response.status).toBe(401);
  });
});
