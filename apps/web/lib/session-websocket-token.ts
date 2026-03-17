import type { SessionWebSocketTokenResponse } from "@repo/shared";

const SESSION_WEBSOCKET_TOKEN_PREFIX = "session-websocket-token:";
const initialSessionWebSocketTokenCache = new Map<string, SessionWebSocketTokenResponse | null>();

function getStorageKey(sessionId: string): string {
  return `${SESSION_WEBSOCKET_TOKEN_PREFIX}${sessionId}`;
}

function isValidSessionWebSocketToken(
  token: Partial<SessionWebSocketTokenResponse> | null | undefined,
): token is SessionWebSocketTokenResponse {
  return (
    typeof token?.token === "string"
    && typeof token.expiresAt === "string"
    && !Number.isNaN(Date.parse(token.expiresAt))
    && Date.parse(token.expiresAt) > Date.now()
  );
}

export function storeInitialSessionWebSocketToken(
  sessionId: string,
  token: SessionWebSocketTokenResponse,
): void {
  if (typeof window === "undefined") {
    return;
  }

  initialSessionWebSocketTokenCache.set(sessionId, token);
  sessionStorage.setItem(getStorageKey(sessionId), JSON.stringify(token));
}

export function consumeInitialSessionWebSocketToken(
  sessionId: string,
): SessionWebSocketTokenResponse | null {
  if (typeof window === "undefined") {
    return null;
  }

  const memoryCachedToken = initialSessionWebSocketTokenCache.get(sessionId);
  if (memoryCachedToken !== undefined) {
    if (!isValidSessionWebSocketToken(memoryCachedToken)) {
      initialSessionWebSocketTokenCache.delete(sessionId);
      sessionStorage.removeItem(getStorageKey(sessionId));
      return null;
    }

    return memoryCachedToken;
  }

  const storageKey = getStorageKey(sessionId);
  const rawValue = sessionStorage.getItem(storageKey);

  if (!rawValue) {
    initialSessionWebSocketTokenCache.set(sessionId, null);
    return null;
  }

  sessionStorage.removeItem(storageKey);

  try {
    const parsed = JSON.parse(rawValue) as Partial<SessionWebSocketTokenResponse>;

    if (!isValidSessionWebSocketToken(parsed)) {
      initialSessionWebSocketTokenCache.set(sessionId, null);
      return null;
    }

    const token = {
      token: parsed.token,
      expiresAt: parsed.expiresAt,
    };
    initialSessionWebSocketTokenCache.set(sessionId, token);
    return token;
  } catch {
    initialSessionWebSocketTokenCache.set(sessionId, null);
    return null;
  }
}
