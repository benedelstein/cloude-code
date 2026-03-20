"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  useCloudflareAgent,
  type UseCloudflareAgentReturn,
} from "@/hooks/use-cloudflare-agent";
import { useSessionWebSocketToken } from "@/hooks/use-session-websocket-token";
import type { SessionStatus, SessionWebSocketTokenResponse } from "@repo/shared";

const SessionContext = createContext<UseCloudflareAgentReturn | null>(null);

export function useSession(): UseCloudflareAgentReturn {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}

interface SessionProviderProps {
  sessionId: string;
  children: ReactNode;
}

interface SessionProviderWithTokenProps extends SessionProviderProps {
  webSocketToken: SessionWebSocketTokenResponse;
}

// fake session object for when we don't have a wss token yet
function createPendingSession(
  sessionId: string,
  sessionStatus: SessionStatus | null,
  errorMessage: string | null,
): UseCloudflareAgentReturn {
  return {
    sessionId,
    messages: [],
    streamingMessage: null,
    sessionStatus,
    errorMessage,
    isHistoryLoading: errorMessage === null,
    hasHydratedState: false,
    isReady: false,
    isStreaming: false,
    isResponding: false,
    pendingUserMessage: null,
    repoFullName: null,
    pushedBranch: null,
    pullRequestUrl: null,
    pullRequestState: null,
    todos: null,
    plan: null,
    settings: null,
    selectedModel: null,
    setSelectedModel: () => {},
    editorUrl: null,
    claudeAuthRequired: null,
    sendMessage: () => {},
    stop: () => {},
  };
}

function SessionProviderWithToken({
  sessionId,
  webSocketToken,
  children,
}: SessionProviderWithTokenProps) {
  const session = useCloudflareAgent({
    sessionId,
    webSocketToken,
    onError: (error) => {
      console.error("Session error:", error);
    },
  });

  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}

// Branch on the websocket token
// if the token doesnt exist, show a placeholder session state object until the token is fetched.
// TODO: we may want to use SSR and just fetch the websocket token and myabe the session info in a server component.
// this would simplify the client flow at the expense of some latency.
export function SessionProvider({ sessionId, children }: SessionProviderProps) {
  const [tokenSessionStatus, setTokenSessionStatus] = useState<SessionStatus | null>(null);
  const [tokenErrorMessage, setTokenErrorMessage] = useState<string | null>(null);

  const webSocketToken = useSessionWebSocketToken({
    sessionId,
    onAuthError: () => {
      setTokenErrorMessage("Session authentication failed");
    },
    onReconnectPending: () => {
      setTokenErrorMessage((currentError) => currentError ?? "Reconnecting...");
    },
    onReconnectRecovered: () => {
      setTokenSessionStatus(null);
      setTokenErrorMessage((currentError) => currentError === "Reconnecting..." ? null : currentError);
    },
  });

  const pendingSession = useMemo(() => {
    return createPendingSession(sessionId, tokenSessionStatus, tokenErrorMessage);
  }, [sessionId, tokenErrorMessage, tokenSessionStatus]);

  if (!webSocketToken) {
    return (
      <SessionContext.Provider value={pendingSession}>
        {children}
      </SessionContext.Provider>
    );
  }

  return (
    <SessionProviderWithToken sessionId={sessionId} webSocketToken={webSocketToken}>
      {children}
    </SessionProviderWithToken>
  );
}
