import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseVoiceInputResult } from "@/hooks/use-voice-input";
import { TooltipProvider } from "@/components/ui/tooltip";

const {
  addSession,
  createSession,
  getProviderHandle,
  providerHandle,
  push,
  selectedRepo,
  useVoiceInput,
  useImageAttachments,
  voiceInputState,
} = vi.hoisted(() => ({
  addSession: vi.fn(),
  createSession: vi.fn(),
  getProviderHandle: vi.fn(),
  push: vi.fn(),
  providerHandle: {
    providerId: "claude-code",
    connected: true,
    loading: false,
    requiresReauth: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
  selectedRepo: {
    id: 42,
    fullName: "ben/repo",
    defaultBranch: "main",
  },
  voiceInputState: {
    result: null as UseVoiceInputResult | null,
    options: null as {
      onInsertTranscript: (text: string) => void;
      onSendTranscript: (text: string) => void;
    } | null,
  },
  useVoiceInput: vi.fn((options) => {
    voiceInputState.options = options;
    return voiceInputState.result;
  }),
  useImageAttachments: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/lib/client-api", () => ({
  createSession,
  deleteAttachment: vi.fn(async () => undefined),
  listBranches: vi.fn(async () => ({ branches: [], cursor: null })),
  uploadAttachments: vi.fn(async () => ({ attachments: [] })),
}));

vi.mock("@/hooks/use-provider-auth", () => ({
  useProviderAuth: () => ({
    handles: [providerHandle],
    getHandle: getProviderHandle,
    isAnyLoading: false,
  }),
}));

vi.mock("@/hooks/use-image-attachments", () => ({
  useImageAttachments,
}));

vi.mock("@/components/providers/session-list-provider", () => ({
  useSessionList: () => ({ addSession }),
}));

vi.mock("@/hooks/use-voice-input", () => ({
  VOICE_SIGNAL_BAR_COUNT: 220,
  useVoiceInput,
}));

vi.mock("@/components/model-providers/provider-model-effort-selector", () => ({
  ProviderModelEffortSelector: () => React.createElement("div", { "data-testid": "provider-selector" }),
}));

vi.mock("@/components/model-providers/provider-signin-panel", () => ({
  ProviderSigninPanel: () => null,
}));

vi.mock("@/components/chat/chat-attachment-previews", () => ({
  ChatAttachmentPreviews: () => null,
}));

vi.mock("@/app/(app)/session-creation-selectors", () => ({
  BranchSelector: () => React.createElement("div"),
  mergeBranches: (_current: unknown[], next: unknown[]) => next,
}));

vi.mock("@/app/(app)/repo-selector", () => ({
  RepoSelector: () => React.createElement("div"),
}));

vi.mock("@/app/(app)/use-repo-picker", () => ({
  useRepoPicker: () => ({
    visibleRepos: [],
    installUrl: null,
    loading: false,
    cursor: null,
    loadingMore: false,
    selectedRepo,
    setSelectedRepo: vi.fn(),
    searchQuery: "",
    setSearchQuery: vi.fn(),
    searching: false,
    isSearchMode: false,
    open: false,
    setOpen: vi.fn(),
    loadMore: vi.fn(),
  }),
}));

vi.mock("@/app/(app)/session-environment-selector", () => ({
  SessionEnvironmentSelector: () => React.createElement("div"),
}));

import { SessionCreationForm } from "@/app/(app)/session-creation-form";

function idleVoiceInput(): UseVoiceInputResult {
  return {
    state: { status: "idle", elapsedMs: 0, levels: [] },
    isSupported: true,
    isActive: false,
    startRecording: vi.fn(async () => undefined),
    stopAndInsert: vi.fn(async () => undefined),
    stopAndSend: vi.fn(async () => undefined),
    retryInsert: vi.fn(async () => undefined),
    retrySend: vi.fn(async () => undefined),
    retryLast: vi.fn(async () => undefined),
    discardDraft: vi.fn(async () => undefined),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SessionCreationForm voice integration", () => {
  beforeEach(() => {
    addSession.mockReset();
    getProviderHandle.mockReturnValue(providerHandle);
    createSession.mockResolvedValue({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      title: null,
      websocketToken: "socket-token",
      websocketTokenExpiresAt: "2026-05-29T00:00:00.000Z",
    });
    push.mockReset();
    voiceInputState.result = idleVoiceInput();
    voiceInputState.options = null;
    useImageAttachments.mockReturnValue({
      attachments: [],
      addFiles: vi.fn(),
      removeAttachment: vi.fn(),
      clearAttachments: vi.fn(),
      uploadedDescriptors: [],
      isUploading: false,
      hasPendingOrFailedUploads: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("inserts voice transcript into the initial message composer", async () => {
    render(React.createElement(
      TooltipProvider,
      null,
      React.createElement(SessionCreationForm),
    ));
    await act(async () => {
      await flushMicrotasks();
    });

    const textarea = screen.getByPlaceholderText("Describe what you want to do...");
    act(() => {
      voiceInputState.options?.onInsertTranscript("start a session");
    });

    expect((textarea as HTMLTextAreaElement).value).toBe("start a session");
  });

  it("submits voice transcript through session creation", async () => {
    render(React.createElement(
      TooltipProvider,
      null,
      React.createElement(SessionCreationForm),
    ));
    await act(async () => {
      await flushMicrotasks();
    });

    await act(async () => {
      voiceInputState.options?.onSendTranscript("start a session");
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled();
    });
    expect(createSession.mock.calls[0]?.[1]).toEqual({
      content: "start a session",
      attachmentIds: [],
    });
  });
});
