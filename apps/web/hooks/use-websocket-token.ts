"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/client-api";
import type { WebSocketTokenLike } from "@/lib/websocket-token";

const MAX_WEBSOCKET_TOKEN_RETRY_DELAY_MS = 30 * 1000;

interface UseWebSocketTokenOptions<TToken extends WebSocketTokenLike> {
  tokenKey: string;
  requestToken: () => Promise<TToken>;
  enabled?: boolean;
  getInitialToken?: () => TToken | null;
  clearTokenOnRefresh?: boolean;
  onAuthError?: (error: { message: string; code: string | null }) => void;
  onReconnectPending?: () => void;
  onReconnectRecovered?: () => void;
}

export interface UseWebSocketTokenResult<TToken extends WebSocketTokenLike> {
  token: TToken | null;
  refresh: () => void;
}

/**
 * Manages mint/retry state for websocket upgrade tokens. This hook does not
 * open sockets; transport hooks call refresh() when a reconnect needs a new token.
 */
export function useWebSocketToken<TToken extends WebSocketTokenLike>({
  tokenKey,
  requestToken,
  enabled = true,
  getInitialToken,
  clearTokenOnRefresh = false,
  onAuthError,
  onReconnectPending,
  onReconnectRecovered,
}: UseWebSocketTokenOptions<TToken>): UseWebSocketTokenResult<TToken> {
  const [hasTerminalAuthError, setHasTerminalAuthError] = useState(false);
  const [webSocketToken, setWebSocketToken] = useState<TToken | null>(() =>
    enabled ? getInitialToken?.() ?? null : null,
  );
  const webSocketTokenRetryTimeoutRef = useRef<number | null>(null);
  const webSocketTokenRetryCountRef = useRef(0);
  const webSocketTokenRef = useRef<TToken | null>(webSocketToken);
  const tokenKeyRef = useRef(tokenKey);
  const callbacksRef = useRef({
    onAuthError,
    onReconnectPending,
    onReconnectRecovered,
  });

  useEffect(() => {
    callbacksRef.current = {
      onAuthError,
      onReconnectPending,
      onReconnectRecovered,
    };
  }, [onAuthError, onReconnectPending, onReconnectRecovered]);

  const clearWebSocketTokenRetryTimeout = useCallback(() => {
    if (webSocketTokenRetryTimeoutRef.current !== null) {
      window.clearTimeout(webSocketTokenRetryTimeoutRef.current);
      webSocketTokenRetryTimeoutRef.current = null;
    }
  }, []);

  // Shared path for initial mint, explicit refresh, and retry backoff.
  const fetchWebSocketToken = useCallback(async () => {
    if (!enabled) {
      return null;
    }

    try {
      const nextToken = await requestToken();
      webSocketTokenRetryCountRef.current = 0;
      clearWebSocketTokenRetryTimeout();
      setHasTerminalAuthError(false);
      webSocketTokenRef.current = nextToken;
      setWebSocketToken(nextToken);
      callbacksRef.current.onReconnectRecovered?.();
      return nextToken;
    } catch (error) {
      if (
        error instanceof ApiError
        && (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        clearWebSocketTokenRetryTimeout();
        setHasTerminalAuthError(true);
        webSocketTokenRef.current = null;
        setWebSocketToken(null);
        callbacksRef.current.onAuthError?.({
          message: error.message,
          code: error.code ?? null,
        });
        return null;
      }

      const retryDelay = Math.min(
        1000 * 2 ** webSocketTokenRetryCountRef.current,
        MAX_WEBSOCKET_TOKEN_RETRY_DELAY_MS,
      );
      webSocketTokenRetryCountRef.current += 1;
      clearWebSocketTokenRetryTimeout();

      if (!webSocketTokenRef.current) {
        callbacksRef.current.onReconnectPending?.();
      }

      webSocketTokenRetryTimeoutRef.current = window.setTimeout(() => {
        void fetchWebSocketToken();
      }, retryDelay);
      return null;
    }
  }, [
    clearWebSocketTokenRetryTimeout,
    enabled,
    requestToken,
  ]);

  useEffect(() => {
    if (tokenKeyRef.current === tokenKey) {
      return;
    }

    tokenKeyRef.current = tokenKey;
    clearWebSocketTokenRetryTimeout();
    webSocketTokenRetryCountRef.current = 0;
    setHasTerminalAuthError(false);

    const nextToken = enabled ? getInitialToken?.() ?? null : null;
    webSocketTokenRef.current = nextToken;
    setWebSocketToken(nextToken);
  }, [clearWebSocketTokenRetryTimeout, enabled, getInitialToken, tokenKey]);

  // Mint once when enabled and no token is available.
  useEffect(() => {
    if (!enabled) {
      clearWebSocketTokenRetryTimeout();
      setHasTerminalAuthError(false);
      webSocketTokenRef.current = null;
      setWebSocketToken(null);
      return;
    }

    if (webSocketToken || hasTerminalAuthError) {
      return;
    }

    void fetchWebSocketToken();
  }, [
    clearWebSocketTokenRetryTimeout,
    enabled,
    fetchWebSocketToken,
    hasTerminalAuthError,
    webSocketToken,
  ]);

  useEffect(() => {
    return () => {
      clearWebSocketTokenRetryTimeout();
    };
  }, [clearWebSocketTokenRetryTimeout]);

  // Reset retry/auth state, then mint a replacement token.
  const refresh = useCallback(() => {
    clearWebSocketTokenRetryTimeout();
    webSocketTokenRetryCountRef.current = 0;
    setHasTerminalAuthError(false);

    if (clearTokenOnRefresh) {
      webSocketTokenRef.current = null;
      setWebSocketToken(null);
    }

    void fetchWebSocketToken();
  }, [
    clearTokenOnRefresh,
    clearWebSocketTokenRetryTimeout,
    fetchWebSocketToken,
  ]);

  return { token: webSocketToken, refresh };
}
