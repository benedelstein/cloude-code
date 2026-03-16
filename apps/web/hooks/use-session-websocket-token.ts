"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionWebSocketTokenResponse } from "@repo/shared";
import { ApiError, createSessionWebSocketToken } from "@/lib/client-api";
import { consumeInitialSessionWebSocketToken } from "@/lib/session-websocket-token";

const WEBSOCKET_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const MAX_WEBSOCKET_TOKEN_RETRY_DELAY_MS = 30 * 1000;

interface UseSessionWebSocketTokenOptions {
  sessionId: string;
  onAuthError?: () => void;
  onReconnectPending?: () => void;
  onReconnectRecovered?: () => void;
}

export function useSessionWebSocketToken({
  sessionId,
  onAuthError,
  onReconnectPending,
  onReconnectRecovered,
}: UseSessionWebSocketTokenOptions): SessionWebSocketTokenResponse | null {
  const [hasTerminalAuthError, setHasTerminalAuthError] = useState(false);
  const [webSocketToken, setWebSocketToken] = useState<SessionWebSocketTokenResponse | null>(
    () => consumeInitialSessionWebSocketToken(sessionId),
  );
  const previousSessionIdRef = useRef(sessionId);
  const webSocketTokenRefreshTimeoutRef = useRef<number | null>(null);
  const webSocketTokenRetryTimeoutRef = useRef<number | null>(null);
  const webSocketTokenRetryCountRef = useRef(0);

  const clearWebSocketTokenRefreshTimeout = useCallback(() => {
    if (webSocketTokenRefreshTimeoutRef.current !== null) {
      window.clearTimeout(webSocketTokenRefreshTimeoutRef.current);
      webSocketTokenRefreshTimeoutRef.current = null;
    }
  }, []);

  const clearWebSocketTokenRetryTimeout = useCallback(() => {
    if (webSocketTokenRetryTimeoutRef.current !== null) {
      window.clearTimeout(webSocketTokenRetryTimeoutRef.current);
      webSocketTokenRetryTimeoutRef.current = null;
    }
  }, []);

  const fetchWebSocketToken = useCallback(async () => {
    console.log("fetching websocket token", sessionId);
    try {
      const nextToken = await createSessionWebSocketToken(sessionId);
      webSocketTokenRetryCountRef.current = 0;
      clearWebSocketTokenRetryTimeout();
      setHasTerminalAuthError(false);
      setWebSocketToken(nextToken);
      onReconnectRecovered?.();
      return nextToken;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
        clearWebSocketTokenRetryTimeout();
        setHasTerminalAuthError(true);
        onAuthError?.();
        return null;
      }

      // retry with exponential backoff.
      const retryDelay = Math.min(
        1000 * 2 ** webSocketTokenRetryCountRef.current,
        MAX_WEBSOCKET_TOKEN_RETRY_DELAY_MS,
      );
      webSocketTokenRetryCountRef.current += 1;
      clearWebSocketTokenRetryTimeout();

      if (!webSocketToken) {
        onReconnectPending?.();
      }

      webSocketTokenRetryTimeoutRef.current = window.setTimeout(() => {
        void fetchWebSocketToken();
      }, retryDelay);
      return null;
    }
  }, [
    clearWebSocketTokenRetryTimeout,
    onAuthError,
    onReconnectPending,
    onReconnectRecovered,
    sessionId,
    webSocketToken,
  ]);

  // if the session id changes, we need to clear the previous session id and fetch a new token.
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) {
      return;
    }

    previousSessionIdRef.current = sessionId;
    clearWebSocketTokenRefreshTimeout();
    clearWebSocketTokenRetryTimeout();
    webSocketTokenRetryCountRef.current = 0;
    setHasTerminalAuthError(false);
    setWebSocketToken(consumeInitialSessionWebSocketToken(sessionId));
  }, [
    clearWebSocketTokenRefreshTimeout,
    clearWebSocketTokenRetryTimeout,
    sessionId,
  ]);

  // if the websocket token is not set, or there is a terminal auth error, we need to fetch a new token.
  useEffect(() => {
    if (webSocketToken || hasTerminalAuthError) {
      return;
    }

    void fetchWebSocketToken();
  }, [fetchWebSocketToken, hasTerminalAuthError, webSocketToken]);

  // set up a timeout to refresh the websocket token when it is close to expiring.
  useEffect(() => {
    clearWebSocketTokenRefreshTimeout();

    if (!webSocketToken) {
      return;
    }

    const refreshAt =
      new Date(webSocketToken.expiresAt).getTime() - WEBSOCKET_TOKEN_REFRESH_BUFFER_MS;
    const refreshDelay = Math.max(refreshAt - Date.now(), 0);
    console.log("setting up websocket token refresh timeout", new Date(refreshAt).toISOString());

    webSocketTokenRefreshTimeoutRef.current = window.setTimeout(() => {
      void fetchWebSocketToken();
    }, refreshDelay);

    return clearWebSocketTokenRefreshTimeout;
  }, [clearWebSocketTokenRefreshTimeout, fetchWebSocketToken, webSocketToken]);

  useEffect(() => {
    return () => {
      clearWebSocketTokenRefreshTimeout();
      clearWebSocketTokenRetryTimeout();
    };
  }, [clearWebSocketTokenRefreshTimeout, clearWebSocketTokenRetryTimeout]);

  return webSocketToken;
}
