import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteSession,
  getCurrentUser,
  getSessionPlan,
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
});
