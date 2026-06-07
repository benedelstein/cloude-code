import { afterEach, describe, expect, it, vi } from "vitest";
import { mintSessionWebSocketToken } from "../../src/modules/sessions/services/session-websocket-token.service";
import {
  mintVoiceTranscriptionToken,
  verifyVoiceTranscriptionToken,
} from "../../src/modules/voice/services/voice-transcription-token.service";

const SECRET = "top-secret";
const USER_ID = "123e4567-e89b-12d3-a456-426614174001";
const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("voice transcription token", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints and verifies token", async () => {
    const minted = await mintVoiceTranscriptionToken(SECRET, { userId: USER_ID });
    const payload = await verifyVoiceTranscriptionToken(SECRET, minted.token);

    expect(payload).toMatchObject({
      type: "voice-transcription",
      userId: USER_ID,
      maxBytes: minted.maxBytes,
    });
    expect(payload?.jti).toMatch(/[0-9a-f-]{36}/u);
    expect(minted.expiresAt).toMatch(/Z$/u);
  });

  it("expires in less than a minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const minted = await mintVoiceTranscriptionToken(SECRET, { userId: USER_ID });

    expect(Date.parse(minted.expiresAt) - Date.now()).toBe(45_000);
  });

  it("fails with wrong secret", async () => {
    const minted = await mintVoiceTranscriptionToken(SECRET, { userId: USER_ID });
    await expect(verifyVoiceTranscriptionToken("wrong", minted.token)).resolves.toBeNull();
  });

  it("fails when token is malformed", async () => {
    await expect(verifyVoiceTranscriptionToken(SECRET, "not-a-token")).resolves.toBeNull();
  });

  it("fails when token is expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const minted = await mintVoiceTranscriptionToken(SECRET, { userId: USER_ID });

    vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
    await expect(verifyVoiceTranscriptionToken(SECRET, minted.token)).resolves.toBeNull();
  });

  it("rejects websocket tokens", async () => {
    const minted = await mintSessionWebSocketToken(SECRET, {
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    await expect(verifyVoiceTranscriptionToken(SECRET, minted.token)).resolves.toBeNull();
  });
});
