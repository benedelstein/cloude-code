// Buffer reconnects so tokens do not expire during upgrade.
export const WEBSOCKET_TOKEN_EXPIRY_BUFFER_MS = 30 * 1000;

export interface WebSocketTokenLike {
  token: string;
  expiresAt: string;
}

export function isWebSocketTokenExpiredOrExpiring(
  expiresAt: string,
  bufferMs = WEBSOCKET_TOKEN_EXPIRY_BUFFER_MS,
): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  return Date.now() + bufferMs >= expiresAtMs;
}

export function isWebSocketTokenUsable<T extends WebSocketTokenLike>(
  token: Partial<T> | null | undefined,
  bufferMs = WEBSOCKET_TOKEN_EXPIRY_BUFFER_MS,
): token is T {
  return (
    typeof token?.token === "string"
    && typeof token.expiresAt === "string"
    && !isWebSocketTokenExpiredOrExpiring(token.expiresAt, bufferMs)
  );
}
