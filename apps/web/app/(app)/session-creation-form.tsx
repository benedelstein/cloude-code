"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  listBranches,
  createSession,
  uploadAttachments,
  deleteAttachment,
} from "@/lib/client-api";
import { useProviderAuth } from "@/hooks/use-provider-auth";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { ProviderSigninPanel } from "@/components/model-providers/provider-signin-panel";
import { ProviderEffortSelector } from "@/components/model-providers/provider-effort-selector";
import { ProviderModelSelector } from "@/components/model-providers/provider-model-selector";
import type {
  Branch,
  ListBranchesResponse,
  ProviderId,
} from "@repo/shared";
import { PROVIDERS, isProviderEffort, isProviderModel } from "@repo/shared";
import { readCache, writeCache, branchCacheKey } from "@/lib/swr-cache";
import { storeInitialSessionWebSocketToken } from "@/lib/session-websocket-token";
import {
  buildOptimisticUserMessage,
  storeInitialPendingUserMessage,
} from "@/lib/session-pending-user-message";
import { useSessionList } from "@/components/providers/session-list-provider";
import { ChatAttachmentPreviews } from "@/components/chat/chat-attachment-previews";
import { InputFrame } from "@/components/chat/input-frame";
import { ImageAttachButton } from "@/components/chat/image-attach-button";
import { AgentModeToggle } from "@/components/chat/agent-mode-toggle";
import { SendButton } from "@/components/chat/send-button";
import type { AgentMode } from "@repo/shared";
import {
  BranchSelector,
  mergeBranches,
} from "./session-creation-selectors";
import { RepoSelector } from "./repo-selector";
import { useRepoPicker } from "./use-repo-picker";
import { SessionEnvironmentSelector } from "./session-environment-selector";

const LAST_PROVIDER_MODEL_SELECTION_KEY = "lastProviderModelSelection";

type StoredProviderModelSelection = {
  providerId: ProviderId;
  modelId: string;
  effortId: string;
};

function getFallbackProviderModelSelection(
  handles: ReturnType<typeof useProviderAuth>["handles"],
): StoredProviderModelSelection | null {
  const firstConnectedHandle = handles.find((handle) => handle.connected);
  if (firstConnectedHandle) {
    return {
      providerId: firstConnectedHandle.providerId,
      modelId: PROVIDERS[firstConnectedHandle.providerId].defaultModel,
      effortId: PROVIDERS[firstConnectedHandle.providerId].defaultEffort,
    };
  }

  return null;
}

export function SessionCreationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addSession } = useSessionList();
  const isDevelopment = process.env.NODE_ENV === "development";
  const requestedRepoId = Number(searchParams.get("repoId"));
  const requestedRepoFullName = searchParams.get("repoFullName") ?? null;
  const hasRequestedRepo = Number.isFinite(requestedRepoId) && requestedRepoId > 0;

  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesCursor, setBranchesCursor] = useState<string | null>(null);
  const [branchesLoadingMore, setBranchesLoadingMore] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedEffort, setSelectedEffort] = useState<string | null>(null);
  const [selectedAgentMode, setSelectedAgentMode] = useState<AgentMode>("edit");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
  const [showSigninPanel, setShowSigninPanel] = useState(false);
  const [signinPanelProvider, setSigninPanelProvider] = useState<ProviderId>("claude-code");
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const branchesRef = useRef<Branch[]>([]);
  const selectedRepoIdRef = useRef<number | null>(null);
  const {
    visibleRepos,
    installUrl,
    loading: reposLoading,
    cursor: reposCursor,
    loadingMore: reposLoadingMore,
    selectedRepo,
    setSelectedRepo,
    searchQuery: repoSearchQuery,
    setSearchQuery: setRepoSearchQuery,
    searching: repoSearchLoading,
    isSearchMode: isRepoSearchMode,
    open: repoPickerOpen,
    setOpen: setRepoPickerOpen,
    loadMore: loadMoreRepos,
  } = useRepoPicker({
    requestedRepoId: hasRequestedRepo ? requestedRepoId : null,
    requestedRepoFullName,
    useLastSelectedRepo: true,
    autoSelectSingleRepo: true,
    openOnMissingRequestedRepo: true,
  });

  const providerAuth = useProviderAuth();
  const activeHandle = selectedProvider
    ? providerAuth.getHandle(selectedProvider)
    : null;
  const signinPanelHandle = providerAuth.getHandle(signinPanelProvider);
  const isProviderConnected = activeHandle?.connected ?? false;
  const isProviderLoading = activeHandle?.loading ?? false;

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepo?.id ?? null;
  }, [selectedRepo]);

  useEffect(() => {
    branchesRef.current = branches;
  }, [branches]);

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
  const isSendDisabled =
    !selectedProvider ||
    !selectedModel ||
    !selectedEffort ||
    !isProviderConnected ||
    !selectedRepo;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 280)}px`;
  }, [message, isProviderConnected, isProviderLoading]);

  useEffect(() => {
    if (providerAuth.isAnyLoading) {
      return;
    }

    const fallbackSelection = getFallbackProviderModelSelection(providerAuth.handles);
    const activeProviderHandle = selectedProvider
      ? providerAuth.getHandle(selectedProvider)
      : null;

    if (
      selectedProvider &&
      selectedModel &&
      selectedEffort &&
      isProviderModel(selectedProvider, selectedModel) &&
      isProviderEffort(selectedProvider, selectedEffort) &&
      (activeProviderHandle?.connected ?? false)
    ) {
      return;
    }

    let nextSelection: StoredProviderModelSelection | null = null;
    const rawSelection = localStorage.getItem(LAST_PROVIDER_MODEL_SELECTION_KEY);
    if (!selectedProvider && !selectedModel && rawSelection) {
      try {
        const parsed = JSON.parse(rawSelection) as {
          providerId?: string;
          modelId?: string;
          effortId?: string;
        };
        const parsedProviderHandle = parsed.providerId === "claude-code" || parsed.providerId === "openai-codex"
          ? providerAuth.getHandle(parsed.providerId)
          : null;
        if (
          parsed.providerId &&
          parsed.modelId &&
          (parsed.providerId === "claude-code" || parsed.providerId === "openai-codex") &&
          isProviderModel(parsed.providerId, parsed.modelId) &&
          (!parsed.effortId || isProviderEffort(parsed.providerId, parsed.effortId)) &&
          (parsedProviderHandle?.connected ?? false)
        ) {
          nextSelection = {
            providerId: parsed.providerId,
            modelId: parsed.modelId,
            effortId: parsed.effortId ?? PROVIDERS[parsed.providerId].defaultEffort,
          };
        }
      } catch {
        localStorage.removeItem(LAST_PROVIDER_MODEL_SELECTION_KEY);
      }
    }

    const resolvedSelection = nextSelection ?? fallbackSelection;
    if (!resolvedSelection) {
      setSelectedProvider(null);
      setSelectedModel(null);
      setSelectedEffort(null);
      localStorage.removeItem(LAST_PROVIDER_MODEL_SELECTION_KEY);
      return;
    }

    setSelectedProvider(resolvedSelection.providerId);
    setSelectedModel(resolvedSelection.modelId);
    setSelectedEffort(resolvedSelection.effortId);
    localStorage.setItem(
      LAST_PROVIDER_MODEL_SELECTION_KEY,
      JSON.stringify(resolvedSelection),
    );
  }, [
    providerAuth.handles,
    providerAuth.isAnyLoading,
    providerAuth.getHandle,
    selectedModel,
    selectedEffort,
    selectedProvider,
  ]);

  // Fetch branches when selected repo changes
  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      setBranchesCursor(null);
      setBranchesLoadingMore(false);
      setSelectedBranch(null);
      return;
    }

    let stale = false;
    const repoId = selectedRepo.id;
    const defaultBranchName = selectedRepo.defaultBranch;
    const cacheKey = branchCacheKey(repoId);

    // Phase 1: Restore from cache
    const cached = readCache<ListBranchesResponse>(cacheKey);
    if (cached) {
      const cachedBranches = mergeBranches(
        [],
        cached.data.branches,
        defaultBranchName,
      );
      setBranches(cachedBranches);
      setBranchesCursor(cached.data.cursor ?? null);
      const defaultBranch = cachedBranches.find((branch) => branch.default);
      setSelectedBranch(defaultBranch?.name ?? cachedBranches[0]?.name ?? defaultBranchName);
      setBranchesLoading(false);
    } else {
      setBranchesLoading(true);
      setBranches([]);
      setBranchesCursor(null);
      setSelectedBranch(defaultBranchName);
    }
    setBranchesLoadingMore(false);

    // Phase 2: Revalidate
    (async () => {
      try {
        const data = await listBranches(repoId, {});
        if (stale) { return; }
        const nextBranches = mergeBranches([], data.branches, defaultBranchName);
        writeCache(cacheKey, { ...data, branches: nextBranches });
        setBranches(nextBranches);
        setBranchesCursor(data.cursor);

        setSelectedBranch((currentBranch) => {
          if (currentBranch) {
            const stillExists = nextBranches.find((branch) => branch.name === currentBranch);
            if (stillExists) { return currentBranch; }
          }
          const defaultBranch = nextBranches.find((branch) => branch.default);
          return defaultBranch?.name ?? nextBranches[0]?.name ?? defaultBranchName;
        });
      } catch {
        if (stale) { return; }
        if (!cached) {
          setSelectedBranch(defaultBranchName);
        }
      } finally {
        if (!stale) { setBranchesLoading(false); }
      }
    })();

    return () => {
      stale = true;
    };
  }, [selectedRepo]);

  async function loadMoreBranches(): Promise<void> {
    if (!selectedRepo || !branchesCursor || branchesLoadingMore) {
      return;
    }

    const repoId = selectedRepo.id;
    const defaultBranchName = selectedRepo.defaultBranch;
    const cacheKey = branchCacheKey(repoId);
    setBranchesLoadingMore(true);

    try {
      const data = await listBranches(repoId, {
        cursor: branchesCursor,
      });

      if (selectedRepoIdRef.current !== repoId) {
        return;
      }

      const nextBranches = mergeBranches(
        branchesRef.current,
        data.branches,
        defaultBranchName,
      );
      setBranches(nextBranches);
      setBranchesCursor(data.cursor);
      writeCache(cacheKey, {
        branches: nextBranches,
        cursor: data.cursor,
      });
    } catch (error) {
      toast.error("Failed to load more branches", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      if (selectedRepoIdRef.current === repoId) {
        setBranchesLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    if (!showSigninPanel) {
      return;
    }

    if (
      signinPanelHandle.loading ||
      !signinPanelHandle.connected ||
      signinPanelHandle.requiresReauth
    ) {
      return;
    }

    setShowSigninPanel(false);
  }, [
    showSigninPanel,
    signinPanelHandle.connected,
    signinPanelHandle.loading,
    signinPanelHandle.requiresReauth,
  ]);

  const handleProviderModelSelect = (providerId: ProviderId, modelId: string) => {
    setSelectedProvider(providerId);
    setSelectedModel(modelId);
    const effortId = selectedProvider === providerId && selectedEffort
      ? selectedEffort
      : PROVIDERS[providerId].defaultEffort;
    setSelectedEffort(effortId);
    const selection: StoredProviderModelSelection = { providerId, modelId, effortId };
    localStorage.setItem(LAST_PROVIDER_MODEL_SELECTION_KEY, JSON.stringify(selection));
  };

  const handleProviderEffortSelect = (providerId: ProviderId, effortId: string) => {
    if (selectedProvider !== providerId || !selectedModel) { return; }
    setSelectedEffort(effortId);
    const selection: StoredProviderModelSelection = {
      providerId,
      modelId: selectedModel,
      effortId,
    };
    localStorage.setItem(LAST_PROVIDER_MODEL_SELECTION_KEY, JSON.stringify(selection));
  };

  const handleProviderConnect = (providerId: ProviderId) => {
    setSigninPanelProvider(providerId);
    setShowSigninPanel(true);
  };

  const submitMessage = async () => {
    const trimmedMessage = message.trim();
    if (
      !selectedProvider
      || !selectedModel
      || !selectedEffort
      || !isProviderConnected
      || !selectedRepo
      || (!trimmedMessage && attachments.length === 0)
    ) {
      return;
    }
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
        { provider: selectedProvider, model: selectedModel, effort: selectedEffort },
        selectedAgentMode,
        uploadedDescriptors.map((attachment) => attachment.attachmentId),
        selectedEnvironmentId ?? undefined,
      );

      addSession({
        id: session.sessionId,
        repoId: selectedRepo.id,
        repoFullName: selectedRepo.fullName,
        title: session.title,
        archived: false,
        workingState: "responding",
        pushedBranch: null,
        pullRequest: null,
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

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    void submitMessage();
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
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="inline-flex h-8 min-w-0 flex-wrap items-center gap-0 overflow-hidden rounded-md border border-border bg-background">
              <RepoSelector
                repos={visibleRepos}
                selectedRepo={selectedRepo}
                onSelect={setSelectedRepo}
                loading={reposLoading}
                disabled={isFormInteractionDisabled}
                installUrl={installUrl}
                open={repoPickerOpen}
                onOpenChange={setRepoPickerOpen}
                hasMore={reposCursor !== null}
                loadingMore={reposLoadingMore}
                onLoadMore={loadMoreRepos}
                searchQuery={repoSearchQuery}
                onSearchQueryChange={setRepoSearchQuery}
                searching={repoSearchLoading}
                isSearchMode={isRepoSearchMode}
                triggerClassName="h-full rounded-none border-0 bg-transparent px-2 shadow-none hover:bg-muted"
              />
              {selectedRepo && (branches.length > 0 || branchesLoading) && (
                <>
                  <div className="h-4 w-px shrink-0 bg-border" />
                  <BranchSelector
                    branches={branches}
                    selectedBranch={selectedBranch}
                    onSelect={setSelectedBranch}
                    loading={branchesLoading}
                    disabled={isFormInteractionDisabled}
                    open={branchPickerOpen}
                    onOpenChange={setBranchPickerOpen}
                    hasMore={branchesCursor !== null}
                    loadingMore={branchesLoadingMore}
                    onLoadMore={loadMoreBranches}
                    triggerClassName="h-full rounded-none border-0 bg-transparent px-2 shadow-none hover:bg-muted"
                  />
                </>
              )}
            </div>
            <SessionEnvironmentSelector
              selectedRepo={selectedRepo}
              disabled={isFormInteractionDisabled}
              selectedEnvironmentId={selectedEnvironmentId}
              onSelectEnvironment={setSelectedEnvironmentId}
            />
          </div>
        }
      >
          {isDragging && (
            <div className="absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-50/60 dark:bg-blue-950/40">
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Release to attach image</span>
            </div>
          )}
          {!signinPanelHandle.loading && (
            <ProviderSigninPanel
              providerId={signinPanelProvider}
              handle={signinPanelHandle}
              open={showSigninPanel}
              onOpenChange={setShowSigninPanel}
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
            rows={4}
            disabled={isFormInteractionDisabled}
            className="w-full overflow-y-auto bg-transparent px-4 pb-2 pt-4 text-sm resize-none outline-none placeholder:text-foreground-secondary/50 disabled:opacity-50"
          />

          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              <ImageAttachButton
                onFiles={addFiles}
                disabled={isFormInteractionDisabled}
              />
              <AgentModeToggle
                agentMode={selectedAgentMode}
                onToggle={() => setSelectedAgentMode(selectedAgentMode === "plan" ? "edit" : "plan")}
                disabled={isFormInteractionDisabled}
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex min-w-0 max-w-[24rem] shrink items-center gap-1">
                <ProviderModelSelector
                  selectedProvider={selectedProvider}
                  selectedModel={selectedModel}
                  providerAuthHandles={providerAuth.handles}
                  onSelect={handleProviderModelSelect}
                  onConnect={handleProviderConnect}
                  disabled={isFormInteractionDisabled}
                  triggerClassName="rounded-sm pr-1.5"
                />
                <ProviderEffortSelector
                  selectedProvider={selectedProvider}
                  selectedEffort={selectedEffort}
                  onSelect={handleProviderEffortSelect}
                  disabled={isFormInteractionDisabled || !selectedProvider}
                  triggerClassName="rounded-sm pl-1.5"
                />
              </div>
              <SendButton
                isStreaming={false}
                isLoading={submitting || isUploadingAttachments}
                isUploading={isUploadingAttachments}
                disabled={isSendDisabled}
                hasPendingOrFailedUploads={hasPendingOrFailedUploads}
                hasContent={Boolean(message.trim()) || attachments.length > 0}
                onTap={() => void submitMessage()}
              />
            </div>
          </div>
      </InputFrame>

      <div className="relative flex items-center justify-center mt-3">
        {isDevelopment && isProviderConnected && (
          <div className="absolute left-0">
            <button
              type="button"
              onClick={() => void activeHandle?.disconnect()}
              className="px-2 py-1 text-[11px] font-medium rounded-md border border-border text-foreground-secondary hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              Debug: Disconnect {selectedProvider ? PROVIDERS[selectedProvider].displayName : "provider"}
            </button>
          </div>
        )}
        <p className="text-xs text-foreground-secondary/60">
          Press Enter to submit, Shift+Enter for new line
        </p>
      </div>
    </form>
  );
}
