"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  useCloudflareAgent,
  type UseCloudflareAgentReturn,
} from "@/hooks/use-cloudflare-agent";

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
  host?: string;
  children: ReactNode;
}

export function SessionProvider({ sessionId, host, children }: SessionProviderProps) {
  const session = useCloudflareAgent({
    sessionId,
    host,
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
