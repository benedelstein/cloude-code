import { describe, expect, it, vi } from "vitest";
import type { MiddlewareHandler } from "hono";
import { createSessionsRoutes } from "../../src/modules/sessions/routes/sessions.routes";
import type { AuthUser } from "../../src/shared/types/auth";
import type { Env } from "../../src/shared/types";
import type { SessionsService } from "../../src/modules/sessions/services/sessions.service";
import { USER_SESSIONS_USER_ID_HEADER } from "../../src/shared/types/user-sessions";

const USER_ID = "123e4567-e89b-12d3-a456-426614174001";

const testUser: AuthUser = {
  id: USER_ID,
  githubId: 123,
  githubLogin: "ben",
  githubName: "Ben",
  githubAvatarUrl: null,
};

type RouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

function createAuthMiddleware(): MiddlewareHandler<RouteEnv> {
  return async (c, next) => {
    if (c.req.header("Authorization") !== "Bearer good-token") {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", testUser);
    await next();
  };
}

function createEnv(fetchUserSessions: ReturnType<typeof vi.fn>): Env {
  return {
    WEBSOCKET_TOKEN_SIGNING_KEY: "signing-secret",
    USER_SESSIONS: {
      getByName: vi.fn((_name: string) => ({
        fetch: fetchUserSessions,
      })),
    },
  } as unknown as Env;
}

describe("sessions routes user sessions websocket", () => {
  it("rejects the user sessions stream route when token is missing", async () => {
    const fetchUserSessions = vi.fn();
    const verifyUserSessionsWebSocketToken = vi.fn();
    const routes = createSessionsRoutes({
      authMiddleware: createAuthMiddleware(),
      createSessionsService: vi.fn() as never,
      verifyUserSessionsWebSocketToken,
    });

    const response = await routes.fetch(
      new Request("http://test/updates"),
      createEnv(fetchUserSessions),
    );

    expect(response.status).toBe(401);
    expect(verifyUserSessionsWebSocketToken).not.toHaveBeenCalled();
    expect(fetchUserSessions).not.toHaveBeenCalled();
  });

  it("rejects the user sessions stream route when token is invalid", async () => {
    const fetchUserSessions = vi.fn();
    const verifyUserSessionsWebSocketToken = vi.fn(async () => null);
    const routes = createSessionsRoutes({
      authMiddleware: createAuthMiddleware(),
      createSessionsService: vi.fn() as never,
      verifyUserSessionsWebSocketToken,
    });

    const response = await routes.fetch(
      new Request("http://test/updates?token=bad-token"),
      createEnv(fetchUserSessions),
    );

    expect(response.status).toBe(401);
    expect(verifyUserSessionsWebSocketToken).toHaveBeenCalledWith(
      "signing-secret",
      "bad-token",
    );
    expect(fetchUserSessions).not.toHaveBeenCalled();
  });

  it("forwards a valid user sessions stream request to the user-scoped DO", async () => {
    const fetchUserSessions = vi.fn(async () => new Response("forwarded"));
    const verifyUserSessionsWebSocketToken = vi.fn(async () => ({ userId: USER_ID }));
    const env = createEnv(fetchUserSessions);
    const routes = createSessionsRoutes({
      authMiddleware: createAuthMiddleware(),
      createSessionsService: vi.fn() as never,
      verifyUserSessionsWebSocketToken,
    });

    const response = await routes.fetch(
      new Request("http://test/updates?token=good-token&keep=yes", {
        headers: { Upgrade: "websocket" },
      }),
      env,
    );

    const forwardedRequest = fetchUserSessions.mock.calls[0]?.[0] as Request;
    expect(response.status).toBe(200);
    expect(env.USER_SESSIONS.getByName).toHaveBeenCalledWith(USER_ID);
    expect(forwardedRequest.url).toBe("http://user-sessions/");
    expect(forwardedRequest.headers.get(USER_SESSIONS_USER_ID_HEADER)).toBe(USER_ID);
    expect(forwardedRequest.headers.get("Upgrade")).toBe("websocket");
  });

  it("keeps the user sessions token mint route behind auth", async () => {
    const createUserSessionsWebSocketToken = vi.fn(async () => ({
      token: "minted-token",
      expiresAt: "2026-05-29T00:00:00.000Z",
    }));
    const createSessionsService = vi.fn(() => ({
      createUserSessionsWebSocketToken,
    } as unknown as SessionsService));
    const routes = createSessionsRoutes({
      authMiddleware: createAuthMiddleware(),
      createSessionsService,
      verifyUserSessionsWebSocketToken: vi.fn(),
    });

    const rejected = await routes.fetch(
      new Request("http://test/updates/token", { method: "POST" }),
      createEnv(vi.fn()),
    );
    expect(rejected.status).toBe(401);
    expect(createSessionsService).not.toHaveBeenCalled();

    const accepted = await routes.fetch(
      new Request("http://test/updates/token", {
        method: "POST",
        headers: { Authorization: "Bearer good-token" },
      }),
      createEnv(vi.fn()),
    );

    await expect(accepted.json()).resolves.toEqual({
      token: "minted-token",
      expiresAt: "2026-05-29T00:00:00.000Z",
    });
    expect(accepted.status).toBe(200);
    expect(createUserSessionsWebSocketToken).toHaveBeenCalledWith({
      userId: USER_ID,
    });
  });
});
