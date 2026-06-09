import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseVoiceInputResult } from "@/hooks/use-voice-input";
import type { ClaudeAuthHandle } from "@/hooks/use-provider-auth";
import { TooltipProvider } from "@/components/ui/tooltip";

const {
  useVoiceInput,
  useImageAttachments,
  voiceInputState,
} = vi.hoisted(() => ({
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

vi.mock("@/hooks/use-voice-input", () => ({
  VOICE_SIGNAL_BAR_COUNT: 220,
  useVoiceInput,
}));

vi.mock("@/hooks/use-image-attachments", () => ({
  useImageAttachments,
}));

vi.mock("@/components/model-providers/provider-model-effort-selector", () => ({
  ProviderModelEffortSelector: (props: {
    authRequired?: boolean;
    onAuthRequiredClick?: () => void;
  }) => React.createElement(
    "button",
    {
      type: "button",
      "data-testid": "provider-selector",
      "data-auth-required": props.authRequired ? "true" : "false",
      onClick: props.onAuthRequiredClick,
    },
    "Provider selector",
  ),
}));

vi.mock("@/components/model-providers/provider-signin-panel", () => ({
  ProviderSigninPanel: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => props.open
    ? React.createElement(
      "div",
      { "data-testid": "signin-panel" },
      React.createElement(
        "button",
        { type: "button", onClick: () => props.onOpenChange(false) },
        "Close auth",
      ),
    )
    : null,
}));

vi.mock("@/components/chat/chat-attachment-previews", () => ({
  ChatAttachmentPreviews: () => null,
}));

import { ChatInput } from "@/components/chat/chat-input";

function idleVoiceInput(overrides: Partial<UseVoiceInputResult> = {}): UseVoiceInputResult {
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
    ...overrides,
  };
}

function claudeAuthHandle(overrides: Partial<ClaudeAuthHandle> = {}): ClaudeAuthHandle {
  return {
    providerId: "claude-code",
    connected: false,
    requiresReauth: true,
    loading: false,
    error: null,
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    awaitingCode: false,
    code: "",
    setCode: vi.fn(),
    submittingCode: false,
    submitCode: vi.fn(async () => undefined),
    cancelCodeEntry: vi.fn(),
    ...overrides,
  };
}

function renderChatInput(props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const defaultProps: React.ComponentProps<typeof ChatInput> = {
    onSend: vi.fn(),
    onUploadAttachments: vi.fn(async () => []),
    onDeleteAttachment: vi.fn(async () => undefined),
    onStop: vi.fn(),
    selectedProvider: "claude-code",
    selectedModel: "claude-sonnet-4",
    selectedEffort: "default",
    onProviderModelChange: vi.fn(),
    onProviderEffortChange: vi.fn(),
    providerAuthHandles: [],
    providerAuthRequired: null,
  };

  return render(React.createElement(
    TooltipProvider,
    null,
    React.createElement(ChatInput, { ...defaultProps, ...props }),
  ));
}

describe("ChatInput voice integration", () => {
  beforeEach(() => {
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

  it("renders a microphone button next to send while idle", () => {
    renderChatInput();

    expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy();
  });

  it("starts voice recording from the microphone button", () => {
    const startRecording = vi.fn(async () => undefined);
    voiceInputState.result = idleVoiceInput({ startRecording });
    renderChatInput();

    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));

    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it("replaces composer controls with recording actions while recording", () => {
    voiceInputState.result = idleVoiceInput({
      isActive: true,
      state: {
        status: "recording",
        elapsedMs: 1500,
        levels: [0.2, 0.5, 0.8],
      },
    });

    renderChatInput();

    expect(screen.queryByRole("button", { name: "Record voice" })).toBeNull();
    expect(screen.queryByTestId("provider-selector")).toBeNull();
    expect(screen.getByRole("button", { name: "Stop and transcribe" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Transcribe and send" })).toBeTruthy();
  });

  it("inserts voice transcript into the composer", () => {
    renderChatInput();
    const textarea = screen.getByPlaceholderText("Send a message...");

    act(() => {
      voiceInputState.options?.onInsertTranscript("spoken text");
    });

    expect((textarea as HTMLTextAreaElement).value).toBe("spoken text");
  });

  it("submits voice transcript through the send path", () => {
    const onSend = vi.fn();
    renderChatInput({ onSend });

    act(() => {
      voiceInputState.options?.onSendTranscript("spoken text");
    });

    expect(onSend).toHaveBeenCalledWith({
      content: "spoken text",
      attachments: [],
      optimisticAttachments: [],
    });
  });

  it("disables the microphone button when voice is unsupported", () => {
    voiceInputState.result = idleVoiceInput({ isSupported: false });

    renderChatInput();

    expect((screen.getByRole("button", { name: "Voice input unavailable" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("dismisses required reauth while keeping send blocked and picker reauth available", () => {
    const onSend = vi.fn();
    renderChatInput({
      onSend,
      providerAuthHandles: [claudeAuthHandle()],
      providerAuthRequired: { providerId: "claude-code", state: "reauth_required" },
    });

    expect(screen.getByTestId("signin-panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close auth" }));

    expect(screen.queryByTestId("signin-panel")).toBeNull();
    expect(screen.getByTestId("provider-selector").getAttribute("data-auth-required")).toBe("true");

    fireEvent.change(screen.getByPlaceholderText("Send a message..."), {
      target: { value: "hello" },
    });
    const sendButton = screen.getByRole("button", {
      name: "Enter to send. Shift+Enter for new line.",
    }) as HTMLButtonElement;

    expect(sendButton.disabled).toBe(true);
    fireEvent.click(sendButton);
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("provider-selector"));

    expect(screen.getByTestId("signin-panel")).toBeTruthy();
  });
});
