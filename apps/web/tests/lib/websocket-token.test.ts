import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isWebSocketTokenExpiredOrExpiring,
  isWebSocketTokenUsable,
  WEBSOCKET_TOKEN_EXPIRY_BUFFER_MS,
} from "@/lib/websocket-token";

describe("websocket token freshness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats malformed and expired timestamps as expired", () => {
    expect(isWebSocketTokenExpiredOrExpiring("not-a-date")).toBe(true);
    expect(isWebSocketTokenExpiredOrExpiring("2000-01-01T00:00:00.000Z")).toBe(true);
  });

  it("treats tokens inside the expiry buffer as expiring", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T12:00:00.000Z"));

    expect(isWebSocketTokenExpiredOrExpiring(
      new Date(Date.now() + WEBSOCKET_TOKEN_EXPIRY_BUFFER_MS - 1).toISOString(),
    )).toBe(true);
    expect(isWebSocketTokenExpiredOrExpiring(
      new Date(Date.now() + WEBSOCKET_TOKEN_EXPIRY_BUFFER_MS + 1).toISOString(),
    )).toBe(false);
  });

  it("validates token shape and freshness together", () => {
    expect(isWebSocketTokenUsable({
      token: "token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })).toBe(true);
    expect(isWebSocketTokenUsable({
      token: "token",
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
    })).toBe(false);
    expect(isWebSocketTokenUsable({ token: "token" })).toBe(false);
  });
});
