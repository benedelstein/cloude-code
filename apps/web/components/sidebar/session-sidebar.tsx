"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { listSessions, listRepos, createSession, deleteSession, type SessionSummary, type Repo } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { formatRelativeTime } from "./utils";

export function SessionSidebar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const activeSessionId = params?.sessionId as string | undefined;

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [creatingSessionFor, setCreatingSessionFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminatingSessionId, setTerminatingSessionId] = useState<string | null>(null);

  useEffect(() => {
    listSessions()
      .then((data) => setSessions(data.sessions))
      .catch((err) => console.error("Failed to load sessions:", err))
      .finally(() => setSessionsLoading(false));
  }, []);

  const handleNewSession = () => {
    if (showRepoPicker) {
      setShowRepoPicker(false);
      return;
    }
    setShowRepoPicker(true);
    setReposLoading(true);
    setError(null);
    listRepos()
      .then((data) => setRepos(data.repos))
      .catch((err) => setError(err.message))
      .finally(() => setReposLoading(false));
  };

  const handleTerminateSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this session? This will delete all associated data permanently.")) {
      return;
    }
    setTerminatingSessionId(sessionId);
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (sessionId === activeSessionId) {
        router.push("/");
      }
    } catch (err) {
      console.error("Failed to terminate session:", err);
    } finally {
      setTerminatingSessionId(null);
    }
  };

  const handleSelectRepo = async (repo: Repo) => {
    setCreatingSessionFor(repo.fullName);
    setError(null);
    try {
      const session = await createSession(repo.id, repo.fullName);
      setShowRepoPicker(false);
      // Add the new session to the top of the list
      setSessions((prev) => [
        {
          id: session.sessionId,
          repoId: repo.id,
          repoFullName: repo.fullName,
          title: null,
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastMessageAt: null,
        },
        ...prev,
      ]);
      router.push(`/session/${session.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreatingSessionFor(null);
    }
  };

  return (
    <aside className="w-[280px] shrink-0 h-screen flex flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="shrink-0 h-12 px-4 flex items-center border-b border-border">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm">cloude-code</span>
          <div className="flex items-center gap-2">
            {user?.avatarUrl && (
              <img
                src={user.avatarUrl}
                alt={user.login}
                className="w-6 h-6 rounded-full"
              />
            )}
            <button
              onClick={logout}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* New session button */}
      <div className="shrink-0 px-3 py-2">
        <button
          onClick={handleNewSession}
          className="w-full px-3 py-2 text-sm font-medium rounded-lg border border-border hover:bg-accent/10 transition-colors cursor-pointer"
        >
          + New session
        </button>
      </div>

      {/* Repo picker dropdown */}
      {showRepoPicker && (
        <div className="shrink-0 px-3 pb-2 border-b border-border">
          {error && (
            <div className="p-2 mb-2 rounded text-xs bg-red-500/10 border border-red-500/20 text-red-500">
              {error}
            </div>
          )}
          {reposLoading ? (
            <div className="flex justify-center py-4">
              <LoadingSpinner />
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {repos.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => handleSelectRepo(repo)}
                  disabled={creatingSessionFor !== null}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-accent/10 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{repo.fullName}</span>
                    {creatingSessionFor === repo.fullName && <LoadingSpinner />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sessionsLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No sessions yet
          </div>
        ) : (
          <ul className="py-1">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const displayTitle = session.title || session.repoFullName.split("/")[1] || session.id.slice(0, 8);
              const timestamp = session.lastMessageAt || session.updatedAt;

              return (
                <li key={session.id} className="group/row">
                  <button
                    onClick={() => router.push(`/session/${session.id}`)}
                    className={`w-full text-left px-4 py-2.5 transition-all duration-150 cursor-pointer ${
                      isActive
                        ? "bg-accent/15 border-r-2 border-accent"
                        : "hover:bg-accent/10 hover:pl-5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">
                        {displayTitle}
                      </span>
                      {terminatingSessionId === session.id ? (
                        <span className="shrink-0"><LoadingSpinner /></span>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground shrink-0 group-hover/row:hidden">
                            {formatRelativeTime(timestamp)}
                          </span>
                          <button
                            onClick={(e) => handleTerminateSession(e, session.id)}
                            className="hidden group-hover/row:flex shrink-0 items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                            title="Terminate session"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {session.repoFullName}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
