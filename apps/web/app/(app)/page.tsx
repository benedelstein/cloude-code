"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { listRepos, createSession, type Repo } from "@/lib/api";
import { useSessionList } from "@/components/providers/session-list-provider";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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
        <h1 className="text-2xl font-semibold mb-1 text-center">
          What do you want to build?
        </h1>
        <p className="text-sm text-foreground-muted mb-8 text-center">
          Pick a repo and describe the task.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-md text-sm bg-danger/10 border border-danger/20 text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="border border-border rounded-lg bg-background overflow-hidden focus-within:ring-1 focus-within:ring-accent/50 focus-within:border-accent/50 transition-shadow">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you want to do..."
              rows={4}
              disabled={submitting}
              className="w-full px-4 pt-4 pb-2 bg-transparent text-sm resize-none outline-none placeholder:text-foreground-muted/50 disabled:opacity-50"
            />

            <div className="flex items-center justify-between px-3 pb-3">
              {/* Repo selector */}
              <div className="flex items-center gap-2">
                {reposLoading ? (
                  <span className="text-xs text-foreground-muted px-1">Loading repos...</span>
                ) : (
                  <>
                    <Select
                      value={selectedRepo ? String(selectedRepo.id) : ""}
                      onValueChange={(value) => {
                        const repo = repos.find((r) => r.id === Number(value));
                        setSelectedRepo(repo ?? null);
                      }}
                      disabled={submitting}
                    >
                      <SelectTrigger className="w-auto max-w-[200px] sm:max-w-[280px]">
                        <SelectValue placeholder="Select a repo" />
                      </SelectTrigger>
                      <SelectContent>
                        {repos.map((repo) => (
                          <SelectItem key={repo.id} value={String(repo.id)}>
                            {repo.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {installUrl && (
                      <a
                        href={installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-foreground-muted hover:text-foreground transition-colors hidden sm:inline"
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
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                {submitting ? (
                  <>
                    <LoadingSpinner className="h-3 w-3" />
                    Creating...
                  </>
                ) : (
                  <>
                    Start
                    <ArrowRight className="h-3 w-3" />
                  </>
                )}
              </button>
            </div>
          </div>

          <p className="text-xs text-foreground-muted/60 mt-2 text-center">
            Press Enter to submit, Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
}
