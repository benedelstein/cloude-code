"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronsUpDown, Check, Settings, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { listRepos, listBranches, createSession, uploadAttachments, deleteAttachment, type Repo } from "@/lib/client-api";
import { useClaudeAuth } from "@/hooks/use-claude-auth";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { ClaudeSigninPanel } from "./claude-signin-panel";
import type { Branch, ListReposResponse, ListBranchesResponse } from "@repo/shared";
import { readCache, writeCache, CACHE_KEY_REPOS, branchCacheKey } from "@/lib/swr-cache";
import { storeInitialSessionWebSocketToken } from "@/lib/session-websocket-token";
import {
  buildOptimisticUserMessage,
  storeInitialPendingUserMessage,
} from "@/lib/session-pending-user-message";
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
import { ChatAttachmentPreviews } from "@/components/chat/chat-attachment-previews";
import { ModelSelector } from "@/components/model-selector";
import { InputFrame } from "@/components/chat/input-frame";
import { ImageAttachButton } from "@/components/chat/image-attach-button";
import type { ClaudeModel } from "@repo/shared";
import Link from "next/link";

function RepoSelector({
  repos,
  selectedRepo,
  onSelect,
  loading,
  disabled,
  installUrl,
  open,
  onOpenChange,
}: {
  repos: Repo[];
  selectedRepo: Repo | null;
  onSelect: (repo: Repo) => void;
  loading: boolean;
  disabled: boolean;
  installUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild disabled={loading || disabled}>
              <button
                type="button"
                disabled={loading || disabled}
                className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-default cursor-pointer w-[200px] sm:w-[240px]"
              >
                <svg
                  className="h-3.5 w-3.5 shrink-0"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                <span className="truncate">
                  {loading && !selectedRepo
                    ? "Loading repos..."
                    : selectedRepo
                      ? selectedRepo.fullName
                      : "Select a repo"}
                </span>
                <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
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
                    onSelect(repo);
                    onOpenChange(false);
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
              <Link
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-foreground-muted hover:bg-muted hover:text-foreground transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
                Configure repo access on GitHub
              </Link>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function BranchSelector({
  branches,
  selectedBranch,
  onSelect,
  loading,
  disabled,
  open,
  onOpenChange,
}: {
  branches: Branch[];
  selectedBranch: string | null;
  onSelect: (branch: string) => void;
  loading: boolean;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild disabled={loading || disabled}>
              <button
                type="button"
                disabled={loading || disabled}
                className="flex items-center gap-1.5 px-3 h-8 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-default cursor-pointer max-w-[180px]"
              >
                <GitBranch className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {loading ? "..." : selectedBranch ?? "Select branch"}
                </span>
                <ChevronsUpDown className="ml-auto h-3 w-3 shrink-0 opacity-50" />
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
                    onSelect(branch.name);
                    onOpenChange(false);
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
  );
}

export function SessionCreationForm() {
  const router = useRouter();
  const { addSession } = useSessionList();
  const isDevelopment = process.env.NODE_ENV === "development";

  const [repos, setRepos] = useState<Repo[]>([]);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>("opus");
  const [showClaudeSigninPanel, setShowClaudeSigninPanel] = useState(false);
  const [isClaudeSigninPanelExiting, setIsClaudeSigninPanelExiting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const claude = useClaudeAuth();
  const {
    attachments,
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
  const isFormInteractionDisabled = submitting;
  const isSubmitDisabled = (
    !claude.connected ||
    !selectedRepo ||
    hasPendingOrFailedUploads ||
    (!message.trim() && attachments.length === 0) ||
    submitting
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 280)}px`;
  }, [message, claude.connected, claude.loading]);

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
    (async () => {
      try {
        const data = await listBranches(repoId);
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
      } catch {
        if (stale) return;
        if (!cached) {
          setSelectedBranch(selectedRepo.defaultBranch);
        }
      } finally {
        if (!stale) setBranchesLoading(false);
      }
    })();

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
    (async () => {
      try {
        const data = await listRepos();
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
      } catch (err) {
        if (!cached) {
          toast.error("Failed to fetch repositories", { description: (err as Error).message });
        }
      } finally {
        setReposLoading(false);
      }
    })();
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

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (!claude.connected || !selectedRepo || (!trimmedMessage && attachments.length === 0)) return;
    if (hasPendingOrFailedUploads) {
      toast.error("Please wait for all attachments to finish uploading (or remove failed uploads).");
      return;
    }

    setSubmitting(true);
    try {
      localStorage.setItem("lastRepoId", String(selectedRepo.id));
      const branchToUse = selectedBranch && selectedBranch !== selectedRepo.defaultBranch
        ? selectedBranch
        : undefined;
      const session = await createSession(
        selectedRepo.id,
        trimmedMessage || undefined,
        branchToUse,
        { provider: "claude-code", model: selectedModel },
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

      storeInitialSessionWebSocketToken(session.sessionId, {
        token: session.websocketToken,
        expiresAt: session.websocketTokenExpiresAt,
      });
      const initialPendingUserMessage = buildOptimisticUserMessage({
        content: trimmedMessage || undefined,
        attachments: uploadedDescriptors,
      });
      if (initialPendingUserMessage) {
        storeInitialPendingUserMessage(session.sessionId, initialPendingUserMessage);
      }

      clearAttachments();
      router.push(`/session/${session.sessionId}`);
    } catch (err) {
      toast.error("Failed to create session. Please try again.", { description: err instanceof Error ? err.message : "Unknown error" });
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
      <InputFrame
        footer={
          <div className="flex items-center gap-2">
            <RepoSelector
              repos={repos}
              selectedRepo={selectedRepo}
              onSelect={setSelectedRepo}
              loading={reposLoading}
              disabled={isFormInteractionDisabled}
              installUrl={installUrl}
              open={repoPickerOpen}
              onOpenChange={setRepoPickerOpen}
            />
            {selectedRepo && (branches.length > 0 || branchesLoading) && (
              <BranchSelector
                branches={branches}
                selectedBranch={selectedBranch}
                onSelect={setSelectedBranch}
                loading={branchesLoading}
                disabled={isFormInteractionDisabled}
                open={branchPickerOpen}
                onOpenChange={setBranchPickerOpen}
              />
            )}
          </div>
        }
      >
          {isDragging && (
            <div className="absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-50/60 dark:bg-blue-950/40">
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Release to attach image</span>
            </div>
          )}
          {showClaudeSigninPanel && !claude.loading && (
            <ClaudeSigninPanel
              claude={claude}
              isExiting={isClaudeSigninPanelExiting}
            />
          )}
          <ChatAttachmentPreviews
            attachments={attachments}
            onRemove={removeAttachment}
          />
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to do..."
            rows={claude.connected || claude.loading ? 4 : 2}
            disabled={isFormInteractionDisabled}
          className={`w-full overflow-y-auto px-4 pb-2 bg-transparent text-sm resize-none outline-none placeholder:text-foreground-muted/50 disabled:opacity-50 ${
            claude.connected || claude.loading ? "pt-4" : "pt-2"
          }`}
        />

          <div className="flex items-center justify-between px-3 pb-3">
            <ImageAttachButton
              onFiles={addFiles}
              disabled={isFormInteractionDisabled}
            />

            <div className="flex items-center gap-3">
              {claude.connected && (
                <ModelSelector
                  selectedModel={selectedModel}
                  onSelect={setSelectedModel}
                  disabled={isFormInteractionDisabled}
                />
              )}
              <button
                type="submit"
                disabled={isSubmitDisabled}
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
      </InputFrame>

      <div className="relative flex items-center justify-center mt-3">
        {isDevelopment && claude.connected && (
          <div className="absolute left-0">
            <button
              type="button"
              onClick={claude.disconnect}
              className="px-2 py-1 text-[11px] font-medium rounded-md border border-border text-foreground-muted hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              Debug: Disconnect Claude
            </button>
          </div>
        )}
        <p className="text-xs text-foreground-muted/60">
          Press Enter to submit, Shift+Enter for new line
        </p>
      </div>
    </form>
  );
}
