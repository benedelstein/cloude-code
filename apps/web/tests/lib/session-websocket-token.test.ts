import { describe, expect, it } from "vitest";
import {
  consumeInitialSessionWebSocketToken,
  storeInitialSessionWebSocketToken,
} from "@/lib/session-websocket-token";

function createToken(expiresAt: string) {
  return {
    token: "token-1",
    expiresAt,
  };
}

describe("session websocket token storage", () => {
  it("prefers the in-memory cache", () => {
    const token = createToken("2099-01-01T00:00:00.000Z");

    storeInitialSessionWebSocketToken("session-1", token);

    expect(consumeInitialSessionWebSocketToken("session-1")).toEqual(token);
  });

  it("returns a valid token from sessionStorage and removes it from storage", () => {
    const token = createToken("2099-01-01T00:00:00.000Z");

    sessionStorage.setItem(
      "session-websocket-token:session-2",
      JSON.stringify(token),
    );

    expect(consumeInitialSessionWebSocketToken("session-2")).toEqual(token);
    expect(sessionStorage.getItem("session-websocket-token:session-2")).toBeNull();
  });

  it("rejects expired tokens", () => {
    sessionStorage.setItem(
      "session-websocket-token:session-3",
      JSON.stringify(createToken("2000-01-01T00:00:00.000Z")),
    );

    expect(consumeInitialSessionWebSocketToken("session-3")).toBeNull();
  });

  it("rejects malformed payloads", () => {
    sessionStorage.setItem("session-websocket-token:session-4", "{bad json");
    expect(consumeInitialSessionWebSocketToken("session-4")).toBeNull();

    sessionStorage.setItem(
      "session-websocket-token:session-5",
      JSON.stringify({ token: 123 }),
    );
    expect(consumeInitialSessionWebSocketToken("session-5")).toBeNull();
  });
});
