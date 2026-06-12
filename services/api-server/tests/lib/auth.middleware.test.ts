import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  authenticateBearerToken,
  type AuthenticateSession,
  createAuthMiddleware,
} from "../../src/modules/auth/middleware/auth.middleware";
import { NativeAccessTokenService } from "../../src/modules/auth/services/native-access-token.service";
import type { AuthContext } from "../../src/modules/auth/types/auth.types";
import type { Env } from "../../src/shared/types";

const testAuth: AuthContext = {
  userId: "user-1",
};

function createApp(authenticate: AuthenticateSession) {
  const app = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();
  app.use("*", createAuthMiddleware(authenticate));
  app.get("/me", (c) => c.json({ userId: c.get("auth").userId }));
  return app;
}

function createDefaultApp() {
  const app = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();
  app.use("*", createAuthMiddleware());
  app.get("/me", (c) => c.json({ userId: c.get("auth").userId }));
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

  it("stores the authenticated context for downstream handlers", async () => {
    const authenticate = vi.fn<AuthenticateSession>(async () => testAuth);
    const response = await request(createApp(authenticate), {
      headers: { Authorization: "Bearer good-token" },
    });

    await expect(response.json()).resolves.toEqual({ userId: "user-1" });
    expect(response.status).toBe(200);
  });

  it("accepts a valid native JWT without a D1 lookup", async () => {
    const env = {
      WORKER_URL: "https://api.test",
      NATIVE_ACCESS_TOKEN_SIGNING_KEY: "native-access-token-test-signing-key",
      DB: {
        prepare: () => {
          throw new Error("D1 must not be used for native JWT auth");
        },
      },
    } as unknown as Env;
    const token = await new NativeAccessTokenService(env).sign({
      refreshSessionId: "refresh-session-1",
      userId: testAuth.userId,
    });

    const response = await request(createDefaultApp(), {
      headers: { Authorization: `Bearer ${token}` },
    }, env);

    await expect(response.json()).resolves.toEqual({ userId: "user-1" });
    expect(response.status).toBe(200);
  });

  it("accepts a valid native JWT before using a custom opaque-session fallback", async () => {
    const env = {
      WORKER_URL: "https://api.test",
      NATIVE_ACCESS_TOKEN_SIGNING_KEY: "native-access-token-test-signing-key",
    } as unknown as Env;
    const token = await new NativeAccessTokenService(env).sign({
      refreshSessionId: "refresh-session-1",
      userId: testAuth.userId,
    });
    const authenticateOpaqueSession = vi.fn<AuthenticateSession>(
      async () => null,
    );

    const auth = await authenticateBearerToken(
      env,
      token,
      authenticateOpaqueSession,
    );

    expect(auth).toEqual(testAuth);
    expect(authenticateOpaqueSession).not.toHaveBeenCalled();
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
