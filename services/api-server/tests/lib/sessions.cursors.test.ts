import { describe, expect, it } from "vitest";
import {
  decodeRepoCursor,
  decodeSessionCursor,
  encodeRepoCursor,
  encodeSessionCursor,
} from "../../src/modules/sessions/repositories/sessions-cursors.repository";

describe("repo cursor", () => {
  it("round-trips through encode/decode", () => {
    const cursor = { maxUpdatedAt: "2026-05-22 00:00:00", repoId: 42 };
    expect(decodeRepoCursor(encodeRepoCursor(cursor))).toEqual(cursor);
  });

  it("preserves repo ids that contain digits only (no scientific notation drift)", () => {
    const cursor = { maxUpdatedAt: "2026-05-22 00:00:00", repoId: 1234567890 };
    expect(decodeRepoCursor(encodeRepoCursor(cursor))).toEqual(cursor);
  });

  it("returns null for non-base64 input", () => {
    expect(decodeRepoCursor("not base64!@#$%")).toBeNull();
  });

  it("returns null when the separator pipe is missing", () => {
    // base64("no-pipe-here") — valid base64 but no "|" in the decoded text.
    expect(decodeRepoCursor(btoa("no-pipe-here"))).toBeNull();
  });

  it("returns null when the repo id is not a number", () => {
    expect(decodeRepoCursor(btoa("2026-05-22 00:00:00|not-a-number"))).toBeNull();
  });

  it("returns null when the timestamp half is empty", () => {
    expect(decodeRepoCursor(btoa("|42"))).toBeNull();
  });
});

describe("session cursor", () => {
  it("round-trips through encode/decode", () => {
    const cursor = {
      updatedAt: "2026-05-22 00:00:00",
      sessionId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    };
    expect(decodeSessionCursor(encodeSessionCursor(cursor))).toEqual(cursor);
  });

  it("uses the LAST pipe as the separator so timestamps with pipes don't break ids", () => {
    // Defensive: SQLite datetimes don't contain "|" today, but session ids are
    // controlled UUIDs. This guards the invariant that the id half is the
    // suffix after the final "|" rather than the first.
    const synthetic = btoa("weird|ts|with|pipes|session-uuid");
    expect(decodeSessionCursor(synthetic)).toEqual({
      updatedAt: "weird|ts|with|pipes",
      sessionId: "session-uuid",
    });
  });

  it("returns null for non-base64 input", () => {
    expect(decodeSessionCursor("not base64!@#$%")).toBeNull();
  });

  it("returns null when the separator pipe is missing", () => {
    expect(decodeSessionCursor(btoa("no-pipe-here"))).toBeNull();
  });

  it("returns null when the session id half is empty", () => {
    expect(decodeSessionCursor(btoa("2026-05-22 00:00:00|"))).toBeNull();
  });

  it("returns null when the timestamp half is empty", () => {
    expect(decodeSessionCursor(btoa("|sess-1"))).toBeNull();
  });
});
