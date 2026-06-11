"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalServerMessageSchema } from "@repo/shared";
import type { TerminalClientMessage } from "@repo/shared";
import { WS_API_URL } from "@/lib/client-api";
import { isWebSocketTokenExpiredOrExpiring } from "@/lib/websocket-token";
import { useSessionWebSocketToken } from "./use-session-websocket-token";

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 15_000;

export type SessionTerminalStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "exited"
  | "disconnected";

interface UseSessionTerminalOptions {
  sessionId: string;
  /** Connect only while enabled (tab activated, session ready, terminal mounted). */
  enabled: boolean;
  /** Reads the current terminal dimensions at connect time. */
  getDimensions: () => { cols: number; rows: number } | null;
  /** Receives raw PTY output bytes. */
  onData: (data: Uint8Array) => void;
}

export interface UseSessionTerminalResult {
  status: SessionTerminalStatus;
  exitCode: number | null;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  /** Manual reconnect after an exit or repeated failures. */
  reconnect: () => void;
}

function buildSessionTerminalUrl(
  sessionId: string,
  token: string,
  dimensions: { cols: number; rows: number } | null,
): string {
  const url = new URL(`/agents/session/${sessionId}/terminal`, WS_API_URL);
  // Normalize the HTTP API origin for browser WebSocket clients.
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  url.searchParams.set("token", token);
  if (dimensions) {
    url.searchParams.set("cols", String(dimensions.cols));
    url.searchParams.set("rows", String(dimensions.rows));
  }
  return url.toString();
}

/**
 * Owns the raw WebSocket to the session terminal relay. PTY output arrives as
 * binary frames via onData; control messages (exit) are JSON. Reconnects with
 * backoff on unexpected closes (the server re-attaches to the same shell);
 * stops on clean shell exit or after repeated failures.
 */
export function useSessionTerminal({
  sessionId,
  enabled,
  getDimensions,
  onData,
}: UseSessionTerminalOptions): UseSessionTerminalResult {
  const [status, setStatus] = useState<SessionTerminalStatus>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const webSocketRef = useRef<WebSocket | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  // True once the shell exited or retries are exhausted; suppresses reconnects
  // until the user explicitly reconnects.
  const haltedRef = useRef(false);
  const onDataRef = useRef(onData);
  const getDimensionsRef = useRef(getDimensions);

  useEffect(() => {
    onDataRef.current = onData;
    getDimensionsRef.current = getDimensions;
  }, [getDimensions, onData]);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const { token: webSocketToken, refresh: refreshWebSocketToken } =
    useSessionWebSocketToken({ sessionId });

  const scheduleReconnect = useCallback(() => {
    if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
      haltedRef.current = true;
      setStatus("disconnected");
      return;
    }
    const retryDelay = Math.min(
      1000 * 2 ** retryCountRef.current,
      MAX_RECONNECT_DELAY_MS,
    );
    retryCountRef.current += 1;
    clearRetryTimeout();
    retryTimeoutRef.current = window.setTimeout(() => {
      setConnectionAttempt((attempt) => attempt + 1);
    }, retryDelay);
  }, [clearRetryTimeout]);

  useEffect(() => {
    if (!enabled || !webSocketToken || haltedRef.current) {
      return;
    }

    // Token expiry only matters during the next WebSocket upgrade.
    if (isWebSocketTokenExpiredOrExpiring(webSocketToken.expiresAt)) {
      refreshWebSocketToken();
      return;
    }

    setStatus("connecting");
    const webSocket = new WebSocket(
      buildSessionTerminalUrl(sessionId, webSocketToken.token, getDimensionsRef.current()),
    );
    webSocket.binaryType = "arraybuffer";
    webSocketRef.current = webSocket;
    let didCloseIntentionally = false;
    let didExit = false;

    webSocket.onopen = () => {
      retryCountRef.current = 0;
      clearRetryTimeout();
      setExitCode(null);
      setStatus("connected");
    };

    webSocket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        onDataRef.current(new Uint8Array(event.data));
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parseResult = TerminalServerMessageSchema.safeParse(payload);
      if (!parseResult.success) {
        return;
      }

      switch (parseResult.data.type) {
        case "exit":
          didExit = true;
          haltedRef.current = true;
          setExitCode(parseResult.data.exitCode);
          setStatus("exited");
          break;
        case "error":
          break;
        default: {
          const exhaustiveCheck: never = parseResult.data;
          throw new Error(`Unhandled terminal message: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    };

    webSocket.onerror = () => {
      webSocket.close();
    };

    webSocket.onclose = () => {
      webSocketRef.current = null;
      if (didCloseIntentionally || didExit) {
        return;
      }

      setStatus("disconnected");
      // Browser close events hide the server's upgrade status.
      if (isWebSocketTokenExpiredOrExpiring(webSocketToken.expiresAt)) {
        refreshWebSocketToken();
        return;
      }
      scheduleReconnect();
    };

    return () => {
      didCloseIntentionally = true;
      webSocketRef.current = null;
      if (
        webSocket.readyState === WebSocket.CONNECTING
        || webSocket.readyState === WebSocket.OPEN
      ) {
        webSocket.close();
      }
    };
  }, [
    clearRetryTimeout,
    connectionAttempt,
    enabled,
    refreshWebSocketToken,
    scheduleReconnect,
    sessionId,
    webSocketToken,
  ]);

  useEffect(() => {
    return () => clearRetryTimeout();
  }, [clearRetryTimeout]);

  const sendMessage = useCallback((message: TerminalClientMessage) => {
    const webSocket = webSocketRef.current;
    if (webSocket?.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify(message));
    }
  }, []);

  const sendInput = useCallback(
    (data: string) => sendMessage({ type: "input", data }),
    [sendMessage],
  );

  const sendResize = useCallback(
    (cols: number, rows: number) => sendMessage({ type: "resize", cols, rows }),
    [sendMessage],
  );

  const reconnect = useCallback(() => {
    haltedRef.current = false;
    retryCountRef.current = 0;
    clearRetryTimeout();
    setExitCode(null);
    setConnectionAttempt((attempt) => attempt + 1);
  }, [clearRetryTimeout]);

  return { status, exitCode, sendInput, sendResize, reconnect };
}
