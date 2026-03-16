import type { SessionWebSocketTokenResponse } from "@repo/shared";

const SESSION_WEBSOCKET_TOKEN_PREFIX = "session-websocket-token:";

function getStorageKey(sessionId: string): string {
  return `${SESSION_WEBSOCKET_TOKEN_PREFIX}${sessionId}`;
}

export function storeInitialSessionWebSocketToken(
  sessionId: string,
  token: SessionWebSocketTokenResponse,
): void {
  if (typeof window === "undefined") {
    return;
  }

  sessionStorage.setItem(getStorageKey(sessionId), JSON.stringify(token));
}

export function consumeInitialSessionWebSocketToken(
  sessionId: string,
): SessionWebSocketTokenResponse | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storageKey = getStorageKey(sessionId);
  const rawValue = sessionStorage.getItem(storageKey);

  if (!rawValue) {
    return null;
  }

  sessionStorage.removeItem(storageKey);

  try {
    const parsed = JSON.parse(rawValue) as Partial<SessionWebSocketTokenResponse>;

    if (
      typeof parsed.token !== "string"
      || typeof parsed.expiresAt !== "string"
      || Number.isNaN(Date.parse(parsed.expiresAt))
      || Date.parse(parsed.expiresAt) <= Date.now()
    ) {
      return null;
    }

    return {
      token: parsed.token,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}
