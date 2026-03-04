"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronsUpDown, Check, Settings, GitBranch } from "lucide-react";
import { listRepos, listBranches, createSession, type Repo } from "@/lib/api";
import type { Branch } from "@repo/shared";
import { useSessionList } from "@/components/providers/session-list-provider";
import { LoadingSpinner } from "@/components/parts/loading-spinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

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
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);

  // Fetch branches when selected repo changes
  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      setSelectedBranch(null);
      return;
    }
    setBranchesLoading(true);
    setBranches([]);
    setSelectedBranch(selectedRepo.defaultBranch);
    listBranches(selectedRepo.id)
      .then((data) => {
        setBranches(data.branches);
        const defaultBranch = data.branches.find((b) => b.default);
        setSelectedBranch(defaultBranch?.name ?? data.branches[0]?.name ?? null);
      })
      .catch(() => {
        // Silently fall back to default branch from repo
        setSelectedBranch(selectedRepo.defaultBranch);
      })
      .finally(() => setBranchesLoading(false));
  }, [selectedRepo]);

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
      const branchToUse = selectedBranch && selectedBranch !== selectedRepo.defaultBranch
        ? selectedBranch
        : undefined;
      const session = await createSession(selectedRepo.id, selectedRepo.fullName, message.trim(), branchToUse);

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
        <div className="text-6xl mb-4 text-center">☁️</div>
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
          <div className="border border-border-strong rounded-lg bg-background overflow-hidden focus-within:ring-1 focus-within:ring-accent/50 focus-within:border-accent/50 transition-shadow">
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
                  <Popover open={repoPickerOpen} onOpenChange={setRepoPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={submitting}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer max-w-[200px] sm:max-w-[280px]"
                      >
                        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                        <span className="truncate">
                          {selectedRepo ? selectedRepo.fullName : "Select a repo"}
                        </span>
                        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[280px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search repos..." />
                        <CommandList>
                          <CommandEmpty>No repos found.</CommandEmpty>
                          <CommandGroup>
                            {repos.map((repo) => (
                              <CommandItem
                                key={repo.id}
                                value={repo.fullName}
                                onSelect={() => {
                                  setSelectedRepo(repo);
                                  setRepoPickerOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0",
                                    selectedRepo?.id === repo.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate">{repo.fullName}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                        {installUrl && (
                          <div className="border-t border-border p-1">
                            <a
                              href={installUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-foreground-muted hover:bg-muted hover:text-foreground transition-colors"
                            >
                              <Settings className="h-3.5 w-3.5" />
                              Configure repos
                            </a>
                          </div>
                        )}
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}

                {/* Branch selector */}
                {selectedRepo && (
                  branchesLoading ? (
                    <span className="text-xs text-foreground-muted px-1">...</span>
                  ) : branches.length > 0 ? (
                    <Popover open={branchPickerOpen} onOpenChange={setBranchPickerOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          disabled={submitting}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer max-w-[180px]"
                        >
                          <GitBranch className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{selectedBranch ?? "Select branch"}</span>
                          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[240px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search branches..." />
                          <CommandList>
                            <CommandEmpty>No branches found.</CommandEmpty>
                            <CommandGroup>
                              {branches.map((branch) => (
                                <CommandItem
                                  key={branch.name}
                                  value={branch.name}
                                  onSelect={() => {
                                    setSelectedBranch(branch.name);
                                    setBranchPickerOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "h-3.5 w-3.5 shrink-0",
                                      selectedBranch === branch.name ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <span className="truncate">{branch.name}</span>
                                  {branch.default && (
                                    <span className="ml-auto text-[10px] text-foreground-muted">default</span>
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  ) : null
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
