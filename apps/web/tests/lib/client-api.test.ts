import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRepoEnvironment,
  createSession,
  createVoiceTranscriptionToken,
  createUserSessionsWebSocketToken,
  deleteSession,
  getUserRepoEnvironment,
  getCurrentUser,
  getSessionPlan,
  listRepoEnvironments,
  listUserRepoEnvironments,
} from "@/lib/client-api";

describe("client-api", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("maps a default 401 response to Unauthorized", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));

    await expect(getCurrentUser()).rejects.toMatchObject({
      message: "Unauthorized",
      status: 401,
    });
  });

  it("uses plain-text error bodies when present", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("upstream failed", {
      status: 500,
      headers: { "content-type": "text/plain" },
    }));

    await expect(getCurrentUser()).rejects.toMatchObject({
      message: "upstream failed",
      status: 500,
    });
  });

  it("returns null for session plans that do not exist", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: "missing",
    }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }));

    await expect(getSessionPlan("session-1")).resolves.toBeNull();
  });

  it("rethrows non-404 session plan errors as ApiError", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: "boom",
      code: "SERVER_ERROR",
    }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }));

    await expect(getSessionPlan("session-1")).rejects.toMatchObject({
      message: "boom",
      status: 500,
      code: "SERVER_ERROR",
    });
  });

  it("returns undefined for 204 responses", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteSession("session-1")).resolves.toBeUndefined();
  });

  it("requests user sessions websocket tokens from the sessions updates endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      token: "sidebar-token",
      expiresAt: "2026-05-29T00:00:00.000Z",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(createUserSessionsWebSocketToken()).resolves.toEqual({
      token: "sidebar-token",
      expiresAt: "2026-05-29T00:00:00.000Z",
    });

    expect(vi.mocked(fetch).mock.calls[0]).toMatchObject([
      "/api/sessions/updates/token",
      { method: "POST" },
    ]);
  });

  it("requests voice transcription tokens from the voice endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      token: "voice-token",
      expiresAt: "2026-05-29T00:00:00.000Z",
      maxBytes: 10485760,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(createVoiceTranscriptionToken()).resolves.toEqual({
      token: "voice-token",
      expiresAt: "2026-05-29T00:00:00.000Z",
      maxBytes: 10485760,
    });

    expect(vi.mocked(fetch).mock.calls[0]).toMatchObject([
      "/api/voice/transcriptions/token",
      { method: "POST" },
    ]);
  });

  it("sends selected environment id when creating a session", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      title: null,
      websocketToken: "token",
      websocketTokenExpiresAt: "2026-05-29T00:00:00.000Z",
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));

    await createSession(
      42,
      {
        content: "hello",
        attachmentIds: ["123e4567-e89b-12d3-a456-426614174998"],
      },
      undefined,
      undefined,
      undefined,
      "123e4567-e89b-12d3-a456-426614174999",
    );

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      repoId: 42,
      initialMessage: {
        content: "hello",
        attachmentIds: ["123e4567-e89b-12d3-a456-426614174998"],
      },
      environmentId: "123e4567-e89b-12d3-a456-426614174999",
    });
  });

  it("calls repo environment endpoints", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ environments: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ environments: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        environment: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          repoId: 42,
          repoFullName: "ben/web",
          name: "Web",
          network: { mode: "locked" },
          plainEnvVars: {},
          startupScript: null,
          createdAt: "2026-05-29T00:00:00.000Z",
          updatedAt: "2026-05-29T00:00:00.000Z",
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        environment: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          repoId: 42,
          name: "Web",
          network: { mode: "locked" },
          plainEnvVars: {},
          startupScript: null,
          createdAt: "2026-05-29T00:00:00.000Z",
          updatedAt: "2026-05-29T00:00:00.000Z",
        },
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }));

    await listRepoEnvironments(42);
    await listUserRepoEnvironments();
    await getUserRepoEnvironment("123e4567-e89b-12d3-a456-426614174000");
    await createRepoEnvironment(42, {
      name: "Web",
      network: { mode: "locked" },
      plainEnvVars: {},
      startupScript: null,
    });

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/repos/42/environments");
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe("/api/environments");
    expect(vi.mocked(fetch).mock.calls[2]?.[0]).toBe(
      "/api/environments/123e4567-e89b-12d3-a456-426614174000",
    );
    expect(vi.mocked(fetch).mock.calls[3]?.[0]).toBe("/api/repos/42/environments");
  });
});
