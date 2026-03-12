"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listSessions, type SessionSummary } from "@/lib/client-api";

interface SessionListContextValue {
  sessions: SessionSummary[];
  loading: boolean;
  addSession: (session: SessionSummary) => void;
  removeSession: (sessionId: string) => void;
  updateTitle: (sessionId: string, title: string | null) => void;
  refresh: () => void;
}

const SessionListContext = createContext<SessionListContextValue | null>(null);

export function useSessionList(): SessionListContextValue {
  const context = useContext(SessionListContext);
  if (!context) {
    throw new Error("useSessionList must be used within a SessionListProvider");
  }
  return context;
}

/** Returns the title for a single session, only re-renders when that title changes */
export function useSessionTitle(sessionId: string): string | null {
  const { sessions } = useSessionList();
  const title = useMemo(
    () => sessions.find((s) => s.id === sessionId)?.title ?? null,
    [sessions, sessionId],
  );
  return title;
}

export function SessionListProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(() => {
    setLoading(true);
    listSessions()
      .then((data) => setSessions(data.sessions))
      .catch((error) => console.error("Failed to load sessions:", error))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const addSession = useCallback((session: SessionSummary) => {
    setSessions((prev) => [session, ...prev]);
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }, []);

  const updateTitle = useCallback((sessionId: string, title: string | null) => {
    setSessions((prev) => prev.map((session) =>
      session.id === sessionId
        ? { ...session, title }
        : session
    ));
  }, []);

  return (
    <SessionListContext.Provider
      value={{
        sessions,
        loading,
        addSession,
        removeSession,
        updateTitle,
        refresh: fetchSessions,
      }}
    >
      {children}
    </SessionListContext.Provider>
  );
}
