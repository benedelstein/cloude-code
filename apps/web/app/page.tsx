"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSession, listRepos, type Repo } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export default function Home() {
  const { user, loading: authLoading, isAuthenticated, login, logout } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [creatingSessionFor, setCreatingSessionFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) return;
    setReposLoading(true);
    listRepos()
      .then((data) => {
        setRepos(data.repos);
        setInstallUrl(data.installUrl);
      })
      .catch((err) => setError(err.message))
      .finally(() => setReposLoading(false));
  }, [isAuthenticated]);

  const handleSelectRepo = async (repo: Repo) => {
    setCreatingSessionFor(repo.fullName);
    setError(null);
    try {
      const session = await createSession(repo.fullName);
      router.push(`/session/${session.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      setCreatingSessionFor(null);
    }
  };

  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <LoadingSpinner />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">cloude-code</h1>
          <p className="text-muted-foreground">
            Cloud-hosted agent service for code repositories
          </p>
        </div>

        {!isAuthenticated ? (
          <button
            onClick={login}
            className="w-full cursor-pointer py-3 px-4 rounded-lg bg-accent text-accent-foreground font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <GitHubIcon />
            Sign in with GitHub
          </button>
        ) : (
          <div className="space-y-6">
            {/* User header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {user?.avatarUrl && (
                  <img
                    src={user.avatarUrl}
                    alt={user.login}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <span className="font-medium">{user?.login}</span>
              </div>
              <button
                onClick={logout}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign out
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
                {error}
              </div>
            )}

            {/* Repo list */}
            <div>
              <h2 className="text-sm font-medium mb-3 text-muted-foreground">
                Select a repository
              </h2>
              {reposLoading ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : repos.length === 0 ? (
                <div className="text-center py-8 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    No repositories found. Install the GitHub App to get started.
                  </p>
                  {installUrl && (
                    <a
                      href={installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground font-medium hover:opacity-90 transition-opacity text-sm"
                    >
                      <GitHubIcon />
                      Install GitHub App
                    </a>
                  )}
                </div>
              ) : (
                <ul className="space-y-2">
                  {repos.map((repo) => (
                    <li key={repo.id}>
                      <button
                        onClick={() => handleSelectRepo(repo)}
                        disabled={creatingSessionFor !== null}
                        className="w-full text-left px-4 py-3 rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium">{repo.fullName}</span>
                            {repo.private && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                                private
                              </span>
                            )}
                          </div>
                          {creatingSessionFor === repo.fullName && (
                            <LoadingSpinner />
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-sm text-muted-foreground mt-1 truncate">
                            {repo.description}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-5 w-5"
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

function GitHubIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
