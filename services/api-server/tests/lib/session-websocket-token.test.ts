import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mintSessionWebSocketToken,
  verifySessionWebSocketToken,
} from "../../src/lib/session-websocket-token";

const SECRET = "top-secret";
const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ID = "123e4567-e89b-12d3-a456-426614174001";

describe("session websocket token", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints and verifies token", async () => {
    const minted = await mintSessionWebSocketToken(SECRET, { sessionId: SESSION_ID, userId: USER_ID });
    const payload = await verifySessionWebSocketToken(SECRET, minted.token);
    expect(payload).toMatchObject({ type: "session-websocket", sessionId: SESSION_ID, userId: USER_ID });
    expect(minted.expiresAt).toMatch(/Z$/);
  });

  it("fails with wrong secret", async () => {
    const minted = await mintSessionWebSocketToken(SECRET, { sessionId: SESSION_ID, userId: USER_ID });
    await expect(verifySessionWebSocketToken("wrong", minted.token)).resolves.toBeNull();
  });

  it("fails when token is tampered", async () => {
    const minted = await mintSessionWebSocketToken(SECRET, { sessionId: SESSION_ID, userId: USER_ID });
    const [payloadPart, signaturePart] = minted.token.split(".");
    const tampered = `${payloadPart?.replace(/A/u, "B")}.${signaturePart}`;
    await expect(verifySessionWebSocketToken(SECRET, tampered)).resolves.toBeNull();
  });

  it("fails when token is expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const minted = await mintSessionWebSocketToken(SECRET, { sessionId: SESSION_ID, userId: USER_ID });

    vi.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));
    await expect(verifySessionWebSocketToken(SECRET, minted.token)).resolves.toBeNull();
  });
});
