"use client";

import { useCallback } from "react";
import type { SessionWebSocketTokenResponse } from "@repo/shared";
import { createSessionWebSocketToken } from "@/lib/client-api";
import { consumeInitialSessionWebSocketToken } from "@/lib/session-websocket-token";
import { useWebSocketToken } from "./use-websocket-token";

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
  const requestToken = useCallback(
    () => requestSessionWebSocketToken(sessionId),
    [sessionId],
  );
  const getInitialToken = useCallback(
    () => consumeInitialSessionWebSocketToken(sessionId),
    [sessionId],
  );

  return useWebSocketToken({
    tokenKey: sessionId,
    requestToken,
    getInitialToken,
    onAuthError,
    onReconnectPending,
    onReconnectRecovered,
  });
}
