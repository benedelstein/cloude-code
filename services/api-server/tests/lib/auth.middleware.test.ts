import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  type AuthenticateSession,
  createAuthMiddleware,
} from "../../src/modules/auth/middleware/auth.middleware";
import type { AuthUser } from "../../src/modules/auth/types/auth.types";
import type { Env } from "../../src/shared/types";

const testUser: AuthUser = {
  id: "user-1",
  githubId: 123,
  githubLogin: "ben",
  githubName: "Ben",
  githubAvatarUrl: null,
};

function createApp(authenticate: AuthenticateSession) {
  const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();
  app.use("*", createAuthMiddleware(authenticate));
  app.get("/me", (c) => c.json({ userId: c.get("user").id }));
  return app;
}

function request(app: ReturnType<typeof createApp>, init: RequestInit = {}) {
  return app.fetch(new Request("http://test/me", init), {} as Env);
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
});
