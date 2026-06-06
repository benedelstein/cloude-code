"use client";

import { useCallback } from "react";
import type { UserSessionsWebSocketTokenResponse } from "@repo/shared";
import { createUserSessionsWebSocketToken } from "@/lib/client-api";
import { useWebSocketToken } from "./use-websocket-token";

let inFlightWebSocketTokenRequest: Promise<UserSessionsWebSocketTokenResponse> | null = null;

// Deduplicate concurrent mints for the user-scoped sidebar stream.
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
  // User-scoped adapter around the shared token lifecycle.
  const requestToken = useCallback(
    () => requestUserSessionsWebSocketToken(),
    [],
  );

  return useWebSocketToken({
    tokenKey: "user-sessions",
    requestToken,
    enabled,
    clearTokenOnRefresh: true,
    onAuthError,
    onReconnectPending,
    onReconnectRecovered,
  });
}
