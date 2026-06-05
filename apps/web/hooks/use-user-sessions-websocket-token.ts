"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserSessionsWebSocketTokenResponse } from "@repo/shared";
import { ApiError, createUserSessionsWebSocketToken } from "@/lib/client-api";

const MAX_WEBSOCKET_TOKEN_RETRY_DELAY_MS = 30 * 1000;
let inFlightWebSocketTokenRequest: Promise<UserSessionsWebSocketTokenResponse> | null = null;

function requestUserSessionsWebSocketToken(): Promise<UserSessionsWebSocketTokenResponse> {
  if (inFlightWebSocketTokenRequest) {
    return inFlightWebSocketTokenRequest;
  }

  const nextRequest = createUserSessionsWebSocketToken()
    .finally(() => {
      inFlightWebSocketTokenRequest = null;
    });

  inFlightWebSocketTokenRequest = nextRequest;
  return nextRequest;
}

interface UseUserSessionsWebSocketTokenOptions {
  enabled: boolean;
  onAuthError?: (error: { message: string; code: string | null }) => void;
  onReconnectPending?: () => void;
  onReconnectRecovered?: () => void;
}

export interface UseUserSessionsWebSocketTokenResult {
  token: UserSessionsWebSocketTokenResponse | null;
  refresh: () => void;
}

export function useUserSessionsWebSocketToken({
  enabled,
  onAuthError,
  onReconnectPending,
  onReconnectRecovered,
}: UseUserSessionsWebSocketTokenOptions): UseUserSessionsWebSocketTokenResult {
  const [hasTerminalAuthError, setHasTerminalAuthError] = useState(false);
  const [webSocketToken, setWebSocketToken] =
    useState<UserSessionsWebSocketTokenResponse | null>(null);
  const webSocketTokenRetryTimeoutRef = useRef<number | null>(null);
  const webSocketTokenRetryCountRef = useRef(0);

  const clearWebSocketTokenRetryTimeout = useCallback(() => {
    if (webSocketTokenRetryTimeoutRef.current !== null) {
      window.clearTimeout(webSocketTokenRetryTimeoutRef.current);
      webSocketTokenRetryTimeoutRef.current = null;
    }
  }, []);

  const fetchWebSocketToken = useCallback(async () => {
    if (!enabled) {
      return null;
    }

    try {
      const nextToken = await requestUserSessionsWebSocketToken();
      webSocketTokenRetryCountRef.current = 0;
      clearWebSocketTokenRetryTimeout();
      setHasTerminalAuthError(false);
      setWebSocketToken(nextToken);
      onReconnectRecovered?.();
      return nextToken;
    } catch (error) {
      if (
        error instanceof ApiError
        && (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        clearWebSocketTokenRetryTimeout();
        setHasTerminalAuthError(true);
        setWebSocketToken(null);
        onAuthError?.({
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
    enabled,
    onAuthError,
    onReconnectPending,
    onReconnectRecovered,
    webSocketToken,
  ]);

  useEffect(() => {
    if (!enabled) {
      clearWebSocketTokenRetryTimeout();
      setHasTerminalAuthError(false);
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

  const refresh = useCallback(() => {
    clearWebSocketTokenRetryTimeout();
    webSocketTokenRetryCountRef.current = 0;
    setHasTerminalAuthError(false);
    setWebSocketToken(null);
    void fetchWebSocketToken();
  }, [clearWebSocketTokenRetryTimeout, fetchWebSocketToken]);

  return { token: webSocketToken, refresh };
}
