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
import {
  listSessions,
  type SessionRepoGroup,
  type SessionSummary,
} from "@/lib/client-api";
import { useUserSessionsWebSocket } from "@/hooks/use-user-sessions-websocket";

interface SessionListContextValue {
  groups: SessionRepoGroup[];
  loading: boolean;
  nextRepoCursor: string | null;
  loadingMoreRepos: boolean;
  /** Per-repo flag while "load more sessions" is in flight. */
  loadingMoreSessionsByRepo: Record<number, boolean>;
  addSession: (session: SessionSummary) => void;
  removeSession: (sessionId: string) => void;
  updateTitle: (sessionId: string, title: string | null) => void;
  updateSessionSidebarState: (
    sessionId: string,
    state: Pick<SessionSummary, "workingState" | "pushedBranch" | "pullRequest">,
  ) => void;
  loadMoreRepos: () => Promise<void>;
  loadMoreSessionsForRepo: (repoId: number) => Promise<void>;
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

/** Returns the title for a single session; only re-renders when that title changes. */
export function useSessionTitle(sessionId: string): string | null {
  const { groups } = useSessionList();
  const title = useMemo(() => {
    for (const group of groups) {
      const session = group.sessions.find((s) => s.id === sessionId);
      if (session) { return session.title ?? null; }
    }
    return null;
  }, [groups, sessionId]);
  return title;
}

export function SessionListProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<SessionRepoGroup[]>([]);
  const [nextRepoCursor, setNextRepoCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMoreRepos, setLoadingMoreRepos] = useState(false);
  const [loadingMoreSessionsByRepo, setLoadingMoreSessionsByRepo] = useState<
    Record<number, boolean>
  >({});

  const fetchInitial = useCallback((options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? true;
    if (showLoading) {
      setLoading(true);
    }
    listSessions()
      .then((data) => {
        setGroups(data.groups);
        setNextRepoCursor(data.nextRepoCursor);
      })
      .catch((error) => console.error("Failed to load sessions:", error))
      .finally(() => {
        if (showLoading) {
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  const loadMoreRepos = useCallback(async () => {
    if (!nextRepoCursor || loadingMoreRepos) { return; }
    setLoadingMoreRepos(true);
    try {
      const data = await listSessions({ repoCursor: nextRepoCursor });
      setGroups((prev) => {
        // De-dupe defensively: if a repo group already exists, skip the incoming one.
        const existing = new Set(prev.map((g) => g.repoId));
        const incoming = data.groups.filter((g) => !existing.has(g.repoId));
        return [...prev, ...incoming];
      });
      setNextRepoCursor(data.nextRepoCursor);
    } catch (error) {
      console.error("Failed to load more repos:", error);
    } finally {
      setLoadingMoreRepos(false);
    }
  }, [nextRepoCursor, loadingMoreRepos]);

  const loadMoreSessionsForRepo = useCallback(
    async (repoId: number) => {
      if (loadingMoreSessionsByRepo[repoId]) { return; }
      const group = groups.find((g) => g.repoId === repoId);
      if (!group || !group.nextSessionCursor) { return; }
      setLoadingMoreSessionsByRepo((prev) => ({ ...prev, [repoId]: true }));
      try {
        const data = await listSessions({
          repoId,
          sessionCursor: group.nextSessionCursor,
        });
        const incomingGroup = data.groups[0];
        if (!incomingGroup) { return; }
        setGroups((prev) =>
          prev.map((g) => {
            if (g.repoId !== repoId) { return g; }
            const existingIds = new Set(g.sessions.map((s) => s.id));
            const appended = incomingGroup.sessions.filter(
              (s) => !existingIds.has(s.id),
            );
            return {
              ...g,
              sessions: [...g.sessions, ...appended],
              nextSessionCursor: incomingGroup.nextSessionCursor,
            };
          }),
        );
      } catch (error) {
        console.error("Failed to load more sessions:", error);
      } finally {
        setLoadingMoreSessionsByRepo((prev) => {
          const next = { ...prev };
          delete next[repoId];
          return next;
        });
      }
    },
    [groups, loadingMoreSessionsByRepo],
  );

  const addSession = useCallback((session: SessionSummary) => {
    setGroups((prev) => {
      const groupsWithoutSession = prev
        .map((group) => ({
          ...group,
          sessions: group.sessions.filter((s) => s.id !== session.id),
        }))
        .filter((group) => group.sessions.length > 0 || group.nextSessionCursor !== null);
      const existingIndex = groupsWithoutSession.findIndex((g) => g.repoId === session.repoId);
      if (existingIndex === -1) {
        // Brand-new repo: prepend a new group containing this session.
        const newGroup: SessionRepoGroup = {
          repoId: session.repoId,
          repoFullName: session.repoFullName,
          sessions: [session],
          nextSessionCursor: null,
        };
        return [newGroup, ...groupsWithoutSession];
      }
      const existing = groupsWithoutSession[existingIndex]!;
      const updatedGroup: SessionRepoGroup = {
        ...existing,
        // Refresh the display name from the newest session.
        repoFullName: session.repoFullName,
        sessions: [session, ...existing.sessions],
      };
      // New sessions are newest by creation time, so their repo group moves to the top.
      const rest = groupsWithoutSession.filter((_, i) => i !== existingIndex);
      return [updatedGroup, ...rest];
    });
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setGroups((prev) =>
      prev
        .map((group) => ({
          ...group,
          sessions: group.sessions.filter((s) => s.id !== sessionId),
        }))
        // Drop groups that no longer have any sessions to display.
        // Note: this only checks loaded sessions, not the server's full set —
        // if `nextSessionCursor` is set, more sessions for this repo may
        // still exist; keep the group in that case so the "Show more" affordance
        // remains.
        .filter((g) => g.sessions.length > 0 || g.nextSessionCursor !== null),
    );
  }, []);

  const replaceLoadedSession = useCallback((updatedSession: SessionSummary) => {
    setGroups((prev) =>
      prev.map((group) => {
        let didReplace = false;
        const sessions = group.sessions.map((session) => {
          if (session.id !== updatedSession.id) {
            return session;
          }
          didReplace = true;
          return updatedSession;
        });
        if (!didReplace) {
          return group;
        }
        return {
          ...group,
          repoFullName: group.repoId === updatedSession.repoId
            ? updatedSession.repoFullName
            : group.repoFullName,
          sessions,
        };
      }),
    );
  }, []);

  const updateTitle = useCallback((sessionId: string, title: string | null) => {
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        sessions: group.sessions.map((s) =>
          s.id === sessionId ? { ...s, title } : s,
        ),
      })),
    );
  }, []);

  const updateSessionSidebarState = useCallback((
    sessionId: string,
    state: Pick<SessionSummary, "workingState" | "pushedBranch" | "pullRequest">,
  ) => {
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        sessions: group.sessions.map((session) =>
          session.id === sessionId
            ? { ...session, ...state }
            : session,
        ),
      })),
    );
  }, []);

  const refresh = useCallback(() => {
    fetchInitial({ showLoading: false });
  }, [fetchInitial]);

  useUserSessionsWebSocket({
    enabled: !loading,
    onSessionCreated: addSession,
    onSessionUpdated: replaceLoadedSession,
    onSessionRemoved: removeSession,
    onResyncRequired: refresh,
    onAuthError: (error) => {
      console.error("User sessions websocket auth error:", error);
    },
  });

  return (
    <SessionListContext.Provider
      value={{
        groups,
        loading,
        nextRepoCursor,
        loadingMoreRepos,
        loadingMoreSessionsByRepo,
        addSession,
        removeSession,
        updateTitle,
        updateSessionSidebarState,
        loadMoreRepos,
        loadMoreSessionsForRepo,
        refresh,
      }}
    >
      {children}
    </SessionListContext.Provider>
  );
}
