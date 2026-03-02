"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { deleteSession, archiveSession } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useSessionList } from "@/components/providers/session-list-provider";
import { formatRelativeTime } from "./utils";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

export function SessionSidebar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const activeSessionId = params?.sessionId as string | undefined;
  const { sessions, loading: sessionsLoading, removeSession } = useSessionList();

  const [terminatingSessionId, setTerminatingSessionId] = useState<string | null>(null);
  const [archivingSessionId, setArchivingSessionId] = useState<string | null>(null);

  const handleNewSession = () => {
    router.push("/");
  };

  const handleArchiveSession = async (e: React.MouseEvent | React.KeyboardEvent, sessionId: string) => {
    e.stopPropagation();
    setArchivingSessionId(sessionId);
    if (sessionId === activeSessionId) {
      router.push("/");
    }
    try {
      await archiveSession(sessionId);
      removeSession(sessionId);
    } catch (err) {
      console.error("Failed to archive session:", err);
    } finally {
      setArchivingSessionId(null);
    }
  };

  const handleTerminateSession = async (e: React.MouseEvent | React.KeyboardEvent, sessionId: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this session? This will delete all associated data permanently.")) {
      return;
    }
    setTerminatingSessionId(sessionId);
    if (sessionId === activeSessionId) {
      router.push("/");
    }
    try {
      await deleteSession(sessionId);
      removeSession(sessionId);
    } catch (err) {
      console.error("Failed to terminate session:", err);
    } finally {
      setTerminatingSessionId(null);
    }
  };

  return (
    <aside className="w-[280px] shrink-0 h-screen flex flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="shrink-0 h-12 px-4 flex items-center border-b border-border">
        <div className="w-full flex items-center justify-between">
          <div className="font-semibold text-sm">☁️</div>
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

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sessionsLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner className="h-4 w-4" />
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
                  <div
                    onClick={() => router.push(`/session/${session.id}`)}
                    className={`w-full text-left px-4 py-2.5 transition-all duration-150 cursor-pointer ${
                      isActive
                        ? "bg-accent/15 border-r-2 border-accent"
                        : "hover:bg-accent/10 hover:pl-5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate">
                        {displayTitle}
                      </span>
                      {terminatingSessionId === session.id || archivingSessionId === session.id ? (
                        <span className="shrink-0"><LoadingSpinner className="h-4 w-4" /></span>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground shrink-0 group-hover/row:hidden">
                            {formatRelativeTime(timestamp)}
                          </span>
                          <div className="hidden group-hover/row:flex items-center gap-0.5">
                            <button
                              onClick={(e) => handleArchiveSession(e, session.id)}
                              className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                              title="Archive session"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="3" width="20" height="5" rx="1" />
                                <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                                <path d="M10 12h4" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => handleTerminateSession(e, session.id)}
                              className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                              title="Delete session"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {session.repoFullName}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

