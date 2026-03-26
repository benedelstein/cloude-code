"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

interface SessionBootstrapError {
  message: string;
  code: string | null;
}

// fake session object for when we don't have a wss token yet
function createPendingSession(
  sessionId: string,
  sessionStatus: SessionStatus | null,
  sessionError: SessionBootstrapError | null,
): UseCloudflareAgentReturn {
  return {
    sessionId,
    messages: [],
    streamingMessage: null,
    sessionStatus,
    sessionErrorMessage: sessionError?.message ?? null,
    sessionErrorCode: sessionError?.code ?? null,
    operationError: null,
    isHistoryLoading: sessionError === null,
    hasHydratedState: false,
    isReady: false,
    isStreaming: false,
    isResponding: false,
    pendingUserMessage: null,
    repoFullName: null,
    pushedBranch: null,
    pullRequestState: null,
    todos: null,
    plan: null,
    agentSettings: null,
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
  const [tokenError, setTokenError] = useState<SessionBootstrapError | null>(null);

  useEffect(() => {
    setTokenSessionStatus(null);
    setTokenError(null);
  }, [sessionId]);

  const webSocketToken = useSessionWebSocketToken({
    sessionId,
    onAuthError: (error) => {
      setTokenSessionStatus(null);
      setTokenError(error);
    },
    onReconnectPending: () => {
      setTokenError((currentError) => currentError ?? { message: "Reconnecting...", code: null });
    },
    onReconnectRecovered: () => {
      setTokenSessionStatus(null);
      setTokenError((currentError) => currentError?.message === "Reconnecting..." ? null : currentError);
    },
  });

  const pendingSession = useMemo(() => {
    return createPendingSession(sessionId, tokenSessionStatus, tokenError);
  }, [sessionId, tokenError, tokenSessionStatus]);

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
