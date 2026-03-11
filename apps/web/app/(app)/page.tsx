"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronsUpDown, Check, Settings, GitBranch, ImagePlus, X } from "lucide-react";
import { listRepos, listBranches, createSession, uploadAttachments, deleteAttachment, type Repo } from "@/lib/api";
import { useClaudeAuth } from "@/hooks/use-claude-auth";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { ClaudeSigninPanel } from "./claude-signin-panel";
import type { Branch, ListReposResponse, ListBranchesResponse } from "@repo/shared";
import { readCache, writeCache, CACHE_KEY_REPOS, branchCacheKey } from "@/lib/swr-cache";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatClaudeMetadata(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function Home() {
  const router = useRouter();
  const { addSession } = useSessionList();
  const isDevelopment = process.env.NODE_ENV === "development";

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
  const [showClaudeSigninPanel, setShowClaudeSigninPanel] = useState(false);
  const [isClaudeSigninPanelExiting, setIsClaudeSigninPanelExiting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const claude = useClaudeAuth();
  const {
    attachments,
    error: attachmentError,
    setError: setAttachmentError,
    addFiles,
    removeAttachment,
    clearAttachments,
    uploadedDescriptors,
    isUploading: isUploadingAttachments,
    hasPendingOrFailedUploads,
  } = useImageAttachments({
    uploadFile: async (file) => {
      const response = await uploadAttachments([file]);
      const descriptor = response.attachments[0];
      if (!descriptor) {
        throw new Error("Upload succeeded but no attachment descriptor was returned");
      }
      return descriptor;
    },
    deleteAttachment,
  });
  const subscriptionLabel = claude.subscriptionType
    ? `${formatClaudeMetadata(claude.subscriptionType)} subscription`
    : "Claude subscription";
  const tierLabel = claude.rateLimitTier
    ? ` (${formatClaudeMetadata(claude.rateLimitTier)})`
    : "";

  // Fetch branches when selected repo changes
  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      setSelectedBranch(null);
      return;
    }

    let stale = false;
    const repoId = selectedRepo.id;
    const cacheKey = branchCacheKey(repoId);

    // Phase 1: Restore from cache
    const cached = readCache<ListBranchesResponse>(cacheKey);
    if (cached) {
      setBranches(cached.data.branches);
      const defaultBranch = cached.data.branches.find((b) => b.default);
      setSelectedBranch(defaultBranch?.name ?? cached.data.branches[0]?.name ?? null);
      setBranchesLoading(false);
    } else {
      setBranchesLoading(true);
      setBranches([]);
      setSelectedBranch(selectedRepo.defaultBranch);
    }

    // Phase 2: Revalidate
    listBranches(repoId)
      .then((data) => {
        if (stale) return;
        writeCache(cacheKey, data);
        setBranches(data.branches);

        setSelectedBranch((currentBranch) => {
          if (currentBranch) {
            const stillExists = data.branches.find((b) => b.name === currentBranch);
            if (stillExists) return currentBranch;
          }
          const defaultBranch = data.branches.find((b) => b.default);
          return defaultBranch?.name ?? data.branches[0]?.name ?? null;
        });
      })
      .catch(() => {
        if (stale) return;
        if (!cached) {
          setSelectedBranch(selectedRepo.defaultBranch);
        }
      })
      .finally(() => {
        if (!stale) setBranchesLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [selectedRepo]);

  useEffect(() => {
    // Phase 1: Restore from cache (synchronous, instant render)
    const cached = readCache<ListReposResponse>(CACHE_KEY_REPOS);
    if (cached) {
      setRepos(cached.data.repos);
      setInstallUrl(cached.data.installUrl);
      setReposLoading(false);

      const lastRepoId = localStorage.getItem("lastRepoId");
      const lastRepo = lastRepoId
        ? cached.data.repos.find((r) => r.id === Number(lastRepoId))
        : undefined;
      if (lastRepo) {
        setSelectedRepo(lastRepo);
      } else if (cached.data.repos.length === 1) {
        setSelectedRepo(cached.data.repos[0]);
      }
    }

    // Phase 2: Revalidate in the background (always runs)
    listRepos()
      .then((data) => {
        writeCache(CACHE_KEY_REPOS, data);
        setRepos(data.repos);
        setInstallUrl(data.installUrl);

        // Reconcile selection: keep current choice if it still exists in fresh data
        setSelectedRepo((currentSelected) => {
          if (currentSelected) {
            const stillExists = data.repos.find((r) => r.id === currentSelected.id);
            return stillExists ?? null;
          }
          const lastRepoId = localStorage.getItem("lastRepoId");
          const lastRepo = lastRepoId
            ? data.repos.find((r) => r.id === Number(lastRepoId))
            : undefined;
          if (lastRepo) return lastRepo;
          if (data.repos.length === 1) return data.repos[0];
          return null;
        });
      })
      .catch((err) => {
        if (!cached) {
          setError(err.message);
        }
      })
      .finally(() => setReposLoading(false));
  }, []);

  useEffect(() => {
    if (claude.loading) return;

    if (!claude.connected) {
      setShowClaudeSigninPanel(true);
      setIsClaudeSigninPanelExiting(false);
      return;
    }

    if (!showClaudeSigninPanel) return;

    setIsClaudeSigninPanelExiting(true);
    const timeout = window.setTimeout(() => {
      setShowClaudeSigninPanel(false);
      setIsClaudeSigninPanelExiting(false);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [claude.connected, claude.loading, showClaudeSigninPanel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (!claude.connected || !selectedRepo || (!trimmedMessage && attachments.length === 0)) return;
    if (hasPendingOrFailedUploads) {
      setAttachmentError("Please wait for all attachments to finish uploading (or remove failed ones).");
      return;
    }

    setSubmitting(true);
    setError(null);
    setAttachmentError(null);
    try {
      localStorage.setItem("lastRepoId", String(selectedRepo.id));
      const branchToUse = selectedBranch && selectedBranch !== selectedRepo.defaultBranch
        ? selectedBranch
        : undefined;
      const session = await createSession(
        selectedRepo.id,
        selectedRepo.fullName,
        trimmedMessage || undefined,
        branchToUse,
        { provider: "claude-code", model: "opus" },
        uploadedDescriptors.map((attachment) => attachment.attachmentId),
      );

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

      clearAttachments();
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

  const displayedError = error ?? attachmentError;

  return (
    <div className="h-full flex flex-col items-center justify-center px-4 pb-16">
      <div className="w-full max-w-2xl">
        <div className="text-8xl mb-4 text-center">☁️</div>
        <h1 className="text-2xl font-semibold mb-1 text-center">
          What do you want to build?
        </h1>
        <p className="text-sm text-foreground-muted mb-8 text-center">
          Pick a repo and describe the task.
        </p>

        {displayedError && (
          <div className="mb-4 p-3 rounded-md text-sm bg-danger/10 border border-danger/20 text-danger">
            {displayedError}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          onDragOver={(event) => {
            event.preventDefault();
            if (!submitting) {
              setIsDragging(true);
            }
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (submitting) {
              return;
            }
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
            <div className="border border-border-strong rounded-lg bg-background overflow-hidden focus-within:ring-1 focus-within:ring-accent/50 focus-within:border-accent/50 transition-shadow shadow-shadow shadow-xl">
              {showClaudeSigninPanel && !claude.loading && (
                <ClaudeSigninPanel
                  claude={claude}
                  isExiting={isClaudeSigninPanelExiting}
                />
              )}
              <div
                className="grid transition-all duration-300 ease-in-out"
                style={{
                  gridTemplateRows: attachments.length > 0 ? "1fr" : "0fr",
                  opacity: attachments.length > 0 ? 1 : 0,
                }}
              >
                <div className="overflow-hidden">
                  <div className="px-4 pt-4">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-md border ${
                            attachment.status === "error" ? "border-danger" : "border-border"
                          }`}
                        >
                          <img
                            src={attachment.previewUrl}
                            alt={attachment.file.name}
                            className={`h-full w-full object-cover ${
                              attachment.status === "uploading" ? "opacity-60" : ""
                            }`}
                          />
                          {attachment.status === "uploading" && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <LoadingSpinner className="h-4 w-4 text-white" />
                            </div>
                          )}
                          {attachment.status === "error" && (
                            <div className="absolute left-1 top-1 rounded bg-danger/90 px-1 text-[10px] text-white">
                              Failed
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => removeAttachment(attachment.id)}
                            className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-foreground-muted hover:text-foreground"
                            aria-label={`Remove ${attachment.file.name}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isDragging ? "Drop images to attach..." : "Describe what you want to do..."}
                rows={claude.connected || claude.loading ? 4 : 2}
                disabled={submitting}
                className={`w-full px-4 pb-2 bg-transparent text-sm resize-none outline-none placeholder:text-foreground-muted/50 disabled:opacity-50 ${
                  claude.connected || claude.loading ? "pt-4" : "pt-2"
                }`}
              />

              <div className="flex items-center justify-between px-3 pb-3">
                {/* Repo selector */}
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      addFiles(Array.from(event.currentTarget.files ?? []));
                      event.currentTarget.value = "";
                    }}
                  />
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-foreground-muted hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ImagePlus className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Add images</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {reposLoading ? (
                    <span className="text-xs text-foreground-muted px-1">
                      Loading repos...
                    </span>
                  ) : (
                    <Popover
                      open={repoPickerOpen}
                      onOpenChange={setRepoPickerOpen}
                    >
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                disabled={submitting}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer max-w-[200px] sm:max-w-[280px]"
                              >
                                <svg
                                  className="h-3.5 w-3.5 shrink-0"
                                  viewBox="0 0 16 16"
                                  fill="currentColor"
                                >
                                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                                </svg>
                                <span className="truncate">
                                  {selectedRepo
                                    ? selectedRepo.fullName
                                    : "Select a repo"}
                                </span>
                                <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
                              </button>
                            </PopoverTrigger>
                          </TooltipTrigger>
                          <TooltipContent>Select repository</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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
                                      selectedRepo?.id === repo.id
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                  <span className="truncate">
                                    {repo.fullName}
                                  </span>
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
                  {selectedRepo &&
                    (branchesLoading ? (
                      <span className="text-xs text-foreground-muted px-1">
                        ...
                      </span>
                    ) : branches.length > 0 ? (
                      <Popover
                        open={branchPickerOpen}
                        onOpenChange={setBranchPickerOpen}
                      >
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  disabled={submitting}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer max-w-[180px]"
                                >
                                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">
                                    {selectedBranch ?? "Select branch"}
                                  </span>
                                  <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
                                </button>
                              </PopoverTrigger>
                            </TooltipTrigger>
                            <TooltipContent>Select base branch</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
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
                                        selectedBranch === branch.name
                                          ? "opacity-100"
                                          : "opacity-0",
                                      )}
                                    />
                                    <span className="truncate">
                                      {branch.name}
                                    </span>
                                    {branch.default && (
                                      <span className="ml-auto text-[10px] text-foreground-muted">
                                        default
                                      </span>
                                    )}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    ) : null)}
                </div>

                <div className="flex items-center gap-3">
                  {claude.connected && (
                    <div className="text-right leading-tight">
                      <p className="text-[11px] font-medium text-foreground">
                        Claude Opus 4.6
                      </p>
                      <p className="text-[10px] text-foreground-muted">
                        via {subscriptionLabel}{tierLabel}
                      </p>
                    </div>
                  )}
                  {/* Submit button */}
                  <button
                    type="submit"
                    disabled={
                      !claude.connected ||
                      !selectedRepo ||
                      hasPendingOrFailedUploads ||
                      (!message.trim() && attachments.length === 0) ||
                      submitting
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {submitting || isUploadingAttachments ? (
                      <>
                        <LoadingSpinner className="h-3 w-3" />
                        {submitting ? "Creating..." : "Uploading..."}
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
            </div>

            <div className="flex items-center justify-between mt-3">
              <div>
                {isDevelopment && claude.connected && (
                  <button
                    type="button"
                    onClick={claude.disconnect}
                    className="px-2 py-1 text-[11px] font-medium rounded-md border border-border text-foreground-muted hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                  >
                    Debug: Disconnect Claude
                  </button>
                )}
              </div>
              <p className="text-xs text-foreground-muted/60">
                Press Enter to submit, Shift+Enter for new line
              </p>
            </div>
        </form>
      </div>
    </div>
  );
}
