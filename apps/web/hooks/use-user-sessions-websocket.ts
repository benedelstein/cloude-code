"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@repo/shared";
import { UserSessionsServerMessage } from "@repo/shared";
import { WS_API_URL } from "@/lib/client-api";
import { useUserSessionsWebSocketToken } from "./use-user-sessions-websocket-token";

const MAX_WEBSOCKET_RETRY_DELAY_MS = 30 * 1000;

interface UseUserSessionsWebSocketOptions {
  enabled: boolean;
  onSessionCreated: (session: SessionSummary) => void;
  onSessionUpdated: (session: SessionSummary) => void;
  onSessionRemoved: (sessionId: string) => void;
  onResyncRequired: () => void;
  onAuthError?: (error: { message: string; code: string | null }) => void;
}

function buildUserSessionsWebSocketUrl(token: string): string {
  const url = new URL("/sessions/updates", WS_API_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

function closeWebSocketIntentionally(webSocket: WebSocket): void {
  if (
    webSocket.readyState === WebSocket.CONNECTING
    || webSocket.readyState === WebSocket.OPEN
  ) {
    webSocket.close();
  }
}

export function useUserSessionsWebSocket({
  enabled,
  onSessionCreated,
  onSessionUpdated,
  onSessionRemoved,
  onResyncRequired,
  onAuthError,
}: UseUserSessionsWebSocketOptions): void {
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const hasConnectedRef = useRef(false);
  const callbacksRef = useRef({
    onSessionCreated,
    onSessionUpdated,
    onSessionRemoved,
    onResyncRequired,
  });

  useEffect(() => {
    callbacksRef.current = {
      onSessionCreated,
      onSessionUpdated,
      onSessionRemoved,
      onResyncRequired,
    };
  }, [onResyncRequired, onSessionCreated, onSessionRemoved, onSessionUpdated]);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const {
    token: webSocketToken,
    refresh: refreshWebSocketToken,
  } = useUserSessionsWebSocketToken({
    enabled,
    onAuthError,
    onReconnectPending: () => callbacksRef.current.onResyncRequired(),
  });

  const scheduleReconnect = useCallback(() => {
    const retryDelay = Math.min(
      1000 * 2 ** retryCountRef.current,
      MAX_WEBSOCKET_RETRY_DELAY_MS,
    );
    retryCountRef.current += 1;
    clearRetryTimeout();
    retryTimeoutRef.current = window.setTimeout(() => {
      setConnectionAttempt((attempt) => attempt + 1);
    }, retryDelay);
  }, [clearRetryTimeout]);

  useEffect(() => {
    if (!enabled || !webSocketToken) {
      return;
    }

    const webSocket = new WebSocket(buildUserSessionsWebSocketUrl(webSocketToken.token));
    let didCloseIntentionally = false;

    webSocket.onopen = () => {
      retryCountRef.current = 0;
      clearRetryTimeout();
      if (hasConnectedRef.current) {
        callbacksRef.current.onResyncRequired();
      }
      hasConnectedRef.current = true;
    };

    webSocket.onmessage = (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const parseResult = UserSessionsServerMessage.safeParse(payload);
      if (!parseResult.success) {
        return;
      }

      if (process.env.NODE_ENV === "development") {
        console.log("[user-sessions] ws event", parseResult.data);
      }

      switch (parseResult.data.type) {
        case "user_sessions.connected":
          break;
        case "session.summary.created":
          callbacksRef.current.onSessionCreated(parseResult.data.session);
          break;
        case "session.summary.updated":
          callbacksRef.current.onSessionUpdated(parseResult.data.session);
          break;
        case "session.summary.removed":
          callbacksRef.current.onSessionRemoved(parseResult.data.sessionId);
          break;
        case "session.list.resync_required":
          callbacksRef.current.onResyncRequired();
          break;
        default: {
          const exhaustiveCheck: never = parseResult.data;
          throw new Error(`Unhandled user sessions message: ${exhaustiveCheck}`);
        }
      }
    };

    webSocket.onerror = () => {
      webSocket.close();
    };

    webSocket.onclose = () => {
      if (didCloseIntentionally) {
        return;
      }

      callbacksRef.current.onResyncRequired();
      if (Date.now() >= new Date(webSocketToken.expiresAt).getTime()) {
        refreshWebSocketToken();
        return;
      }
      scheduleReconnect();
    };

    return () => {
      didCloseIntentionally = true;
      closeWebSocketIntentionally(webSocket);
    };
  }, [
    clearRetryTimeout,
    connectionAttempt,
    enabled,
    refreshWebSocketToken,
    scheduleReconnect,
    webSocketToken,
  ]);

  useEffect(() => {
    if (!enabled) {
      hasConnectedRef.current = false;
      retryCountRef.current = 0;
      clearRetryTimeout();
    }
  }, [clearRetryTimeout, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        callbacksRef.current.onResyncRequired();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      clearRetryTimeout();
    };
  }, [clearRetryTimeout]);
}
