"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listRepos, createSession, type Repo } from "@/lib/api";
import { useSessionList } from "@/components/providers/session-list-provider";
import { LoadingSpinner } from "@/components/parts/loading-spinner";

export default function Home() {
  const router = useRouter();
  const { addSession } = useSessionList();

  const [repos, setRepos] = useState<Repo[]>([]);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRepos()
      .then((data) => {
        setRepos(data.repos);
        setInstallUrl(data.installUrl);
        const lastRepoId = localStorage.getItem("lastRepoId");
        const lastRepo = lastRepoId
          ? data.repos.find((r) => r.id === Number(lastRepoId))
          : undefined;
        if (lastRepo) {
          setSelectedRepo(lastRepo);
        } else if (data.repos.length === 1) {
          setSelectedRepo(data.repos[0]);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setReposLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo || !message.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      localStorage.setItem("lastRepoId", String(selectedRepo.id));
      const session = await createSession(selectedRepo.id, selectedRepo.fullName, message.trim());

      addSession({
        id: session.sessionId,
        repoId: selectedRepo.id,
        repoFullName: selectedRepo.fullName,
        title: session.title,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
      });

      router.push(`/session/${session.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.stopPropagation();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="h-full flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        <div className="text-[5rem] text-center">☁️</div>
        <h1 className="text-2xl font-semibold mb-1 text-center">
          What do you want to build?
        </h1>
        <p className="text-sm text-muted-foreground mb-8 text-center">
          Pick a repo and describe the task.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg text-sm bg-red-500/10 border border-red-500/20 text-red-500">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="border border-border rounded-xl bg-background overflow-hidden focus-within:ring-1 focus-within:ring-accent/50 transition-shadow">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to do..."
              rows={4}
              disabled={submitting}
              className="w-full px-4 pt-4 pb-2 bg-transparent text-sm resize-none outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
            />

            <div className="flex items-center justify-between px-3 pb-3">
              {/* Repo selector */}
              <div className="flex items-center gap-2">
                {reposLoading ? (
                  <span className="text-xs text-muted-foreground px-1">Loading repos...</span>
                ) : (
                  <>
                    <select
                      value={selectedRepo?.id ?? ""}
                      onChange={(e) => {
                        const repo = repos.find((r) => r.id === Number(e.target.value));
                        setSelectedRepo(repo ?? null);
                      }}
                      disabled={submitting}
                      className="text-xs bg-transparent border border-border rounded-md px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-accent/50 cursor-pointer disabled:opacity-50"
                    >
                      <option value="">Select a repo</option>
                      {repos.map((repo) => (
                        <option key={repo.id} value={repo.id}>
                          {repo.fullName}
                        </option>
                      ))}
                    </select>
                    {installUrl && (
                      <a
                        href={installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Configure repos
                      </a>
                    )}
                  </>
                )}
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={!selectedRepo || !message.trim() || submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? (
                  <>
                    <LoadingSpinner className="h-3 w-3" />
                    Creating...
                  </>
                ) : (
                  <>
                    Start
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground/60 mt-2 text-center">
            Press Enter to submit, Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
}
