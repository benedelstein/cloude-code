"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionWebSocketTokenResponse } from "@repo/shared";
import { ApiError, createSessionWebSocketToken } from "@/lib/client-api";
import { consumeInitialSessionWebSocketToken } from "@/lib/session-websocket-token";

const MAX_WEBSOCKET_TOKEN_RETRY_DELAY_MS = 30 * 1000;
const inFlightWebSocketTokenRequests = new Map<string, Promise<SessionWebSocketTokenResponse>>();

function requestSessionWebSocketToken(
  sessionId: string,
): Promise<SessionWebSocketTokenResponse> {
  const inFlightRequest = inFlightWebSocketTokenRequests.get(sessionId);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const nextRequest = createSessionWebSocketToken(sessionId)
    .finally(() => {
      inFlightWebSocketTokenRequests.delete(sessionId);
    });

  inFlightWebSocketTokenRequests.set(sessionId, nextRequest);
  return nextRequest;
}

interface UseSessionWebSocketTokenOptions {
  sessionId: string;
  onAuthError?: (error: { message: string; code: string | null }) => void;
  onReconnectPending?: () => void;
  onReconnectRecovered?: () => void;
}

export interface UseSessionWebSocketTokenResult {
  token: SessionWebSocketTokenResponse | null;
  // Triggers a fresh token fetch. Call after a websocket closes with a stale token
  // so the next (re)connect handshake uses a valid one.
  refresh: () => void;
}

export function useSessionWebSocketToken({
  sessionId,
  onAuthError,
  onReconnectPending,
  onReconnectRecovered,
}: UseSessionWebSocketTokenOptions): UseSessionWebSocketTokenResult {
  const [hasTerminalAuthError, setHasTerminalAuthError] = useState(false);
  const [webSocketToken, setWebSocketToken] = useState<SessionWebSocketTokenResponse | null>(
    () => consumeInitialSessionWebSocketToken(sessionId),
  );
  const previousSessionIdRef = useRef(sessionId);
  const webSocketTokenRetryTimeoutRef = useRef<number | null>(null);
  const webSocketTokenRetryCountRef = useRef(0);

  const clearWebSocketTokenRetryTimeout = useCallback(() => {
    if (webSocketTokenRetryTimeoutRef.current !== null) {
      window.clearTimeout(webSocketTokenRetryTimeoutRef.current);
      webSocketTokenRetryTimeoutRef.current = null;
    }
  }, []);

  const fetchWebSocketToken = useCallback(async () => {
    try {
      const nextToken = await requestSessionWebSocketToken(sessionId);
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
    clearWebSocketTokenRetryTimeout();
    webSocketTokenRetryCountRef.current = 0;
    setHasTerminalAuthError(false);
    setWebSocketToken(consumeInitialSessionWebSocketToken(sessionId));
  }, [clearWebSocketTokenRetryTimeout, sessionId]);

  // if the websocket token is not set, or there is a terminal auth error, we need to fetch a new token.
  useEffect(() => {
    if (webSocketToken || hasTerminalAuthError) {
      return;
    }

    void fetchWebSocketToken();
  }, [fetchWebSocketToken, hasTerminalAuthError, webSocketToken]);

  useEffect(() => {
    return () => {
      clearWebSocketTokenRetryTimeout();
    };
  }, [clearWebSocketTokenRetryTimeout]);

  const refresh = useCallback(() => {
    void fetchWebSocketToken();
  }, [fetchWebSocketToken]);

  return { token: webSocketToken, refresh };
}
