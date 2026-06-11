import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientState } from "@repo/shared";
import { useCloudflareAgent } from "@/hooks/use-cloudflare-agent";

const mockAgentState = vi.hoisted(() => ({
  send: vi.fn(),
  options: null as null | {
    onMessage: (_event: { data: string }) => void;
    onClose?: () => void;
    onStateUpdate: (_state: ClientState) => void;
  },
}));

vi.mock("agents/react", () => ({
  useAgent: vi.fn((options) => {
    mockAgentState.options = options;
    return { send: mockAgentState.send };
  }),
}));

function renderAgent({
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
  refreshWebSocketToken,
  onMarkRead,
}: {
  expiresAt?: string;
  refreshWebSocketToken?: () => void;
  onMarkRead?: (sessionId: string, messageId: string) => void;
} = {}) {
  return renderHook(() =>
    useCloudflareAgent({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      webSocketToken: {
        token: "token",
        expiresAt,
      },
      refreshWebSocketToken,
      onMarkRead,
    }),
  );
}

function setDocumentVisibility(visibilityState: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
}

function latestSentMessage(): unknown {
  const payload = mockAgentState.send.mock.calls.at(-1)?.[0] as string | undefined;
  return payload ? JSON.parse(payload) : null;
}

function createClientState(activeTurn: ClientState["activeTurn"]): ClientState {
  return {
    repoFullName: "ben/repo",
    status: "ready",
    sessionSetupRun: null,
    agentSettings: { provider: "openai-codex", model: "gpt-5.3-codex", effort: "high", maxTokens: 8192 },
    agentMode: "edit",
    pushedBranch: null,
    pullRequest: null,
    baseBranch: "main",
    todos: null,
    plan: null,
    pendingUserMessage: null,
    activeTurn,
    editorUrl: null,
    providerConnection: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
}

describe("useCloudflareAgent", () => {
  beforeEach(() => {
    mockAgentState.send.mockClear();
    mockAgentState.options = null;
    setDocumentVisibility("visible");
  });

  it("derives responding state from sync activeTurn without pending chunks", () => {
    const { result } = renderAgent();

    act(() => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "sync.response",
          messages: [],
          activeTurn: { userMessageId: "user-message-1" },
        }),
      });
    });

    expect(result.current.isResponding).toBe(true);
    expect(result.current.isStreaming).toBe(false);
  });

  it("keeps local responding state across unrelated server state updates", () => {
    const { result } = renderAgent();

    act(() => {
      result.current.sendMessage({ content: "hello" });
    });
    expect(result.current.isResponding).toBe(true);

    act(() => {
      mockAgentState.options?.onStateUpdate(createClientState(null));
    });

    expect(result.current.isResponding).toBe(true);
  });

  it("clears local waiting when a seen server active turn ends", () => {
    const { result } = renderAgent();

    act(() => {
      result.current.sendMessage({ content: "hello" });
    });
    act(() => {
      mockAgentState.options?.onStateUpdate(
        createClientState({ userMessageId: "user-message-1" }),
      );
    });
    expect(result.current.isResponding).toBe(true);

    act(() => {
      mockAgentState.options?.onStateUpdate(createClientState(null));
    });

    expect(result.current.isResponding).toBe(false);
  });

  it("updates pull request state from client state", () => {
    const { result } = renderAgent();

    act(() => {
      mockAgentState.options?.onStateUpdate({
        ...createClientState(null),
        pullRequest: {
          status: "created",
          url: "https://github.com/ben/repo/pull/12",
          number: 12,
          state: "open",
        },
      });
    });

    expect(result.current.pullRequestState).toEqual({
      status: "created",
      url: "https://github.com/ben/repo/pull/12",
      number: 12,
      state: "open",
    });
  });

  it("updates pushed branch state from client state", () => {
    const { result } = renderAgent();

    act(() => {
      mockAgentState.options?.onStateUpdate({
        ...createClientState(null),
        pushedBranch: "cloude/change-abcd",
        repoFullName: "ben/repo",
      });
    });

    expect(result.current.pushedBranch).toBe("cloude/change-abcd");
    expect(result.current.repoFullName).toBe("ben/repo");
  });

  it("updates base branch state from client state", () => {
    const { result } = renderAgent();

    act(() => {
      mockAgentState.options?.onStateUpdate({
        ...createClientState(null),
        baseBranch: "develop",
      });
    });

    expect(result.current.baseBranch).toBe("develop");
  });

  it("stamps live startedAt metadata on streaming messages", async () => {
    const { result } = renderAgent();

    await act(async () => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "agent.chunks",
          chunks: [
            { type: "start", messageId: "assistant-1" },
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "hello" },
          ],
        }),
      });
      await Promise.resolve();
    });

    const metadata = result.current.streamingMessage?.metadata as { startedAt?: unknown } | undefined;
    expect(typeof metadata?.startedAt).toBe("number");
  });

  it("refreshes the websocket token when the socket closes near expiry", () => {
    const refreshWebSocketToken = vi.fn();
    renderAgent({
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
      refreshWebSocketToken,
    });

    act(() => {
      mockAgentState.options?.onClose?.();
    });

    expect(refreshWebSocketToken).toHaveBeenCalledTimes(1);
  });

  it("marks the latest assistant message read after visible sync", () => {
    const onMarkRead = vi.fn();
    renderAgent({ onMarkRead });

    act(() => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "sync.response",
          messages: [
            { id: "user-message-1", role: "user", parts: [] },
            { id: "assistant-message-1", role: "assistant", parts: [] },
          ],
          activeTurn: null,
        }),
      });
    });

    expect(latestSentMessage()).toEqual({
      type: "session.mark_read",
      messageId: "assistant-message-1",
    });
    expect(onMarkRead).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000",
      "assistant-message-1",
    );
  });

  it("marks a finished assistant message read when visible", () => {
    renderAgent();

    act(() => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "agent.finish",
          message: { id: "assistant-message-1", role: "assistant", parts: [] },
        }),
      });
    });

    expect(latestSentMessage()).toEqual({
      type: "session.mark_read",
      messageId: "assistant-message-1",
    });
  });

  it("marks an aborted finished assistant message read when visible", () => {
    renderAgent();

    act(() => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "agent.finish",
          message: {
            id: "assistant-message-1",
            role: "assistant",
            parts: [],
            metadata: { aborted: true },
          },
        }),
      });
    });

    expect(latestSentMessage()).toEqual({
      type: "session.mark_read",
      messageId: "assistant-message-1",
    });
  });

  it("defers mark-read while hidden and sends it when visible again", () => {
    setDocumentVisibility("hidden");
    renderAgent();

    act(() => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "sync.response",
          messages: [
            { id: "assistant-message-1", role: "assistant", parts: [] },
          ],
          activeTurn: null,
        }),
      });
    });

    expect(mockAgentState.send).not.toHaveBeenCalled();

    act(() => {
      setDocumentVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(latestSentMessage()).toEqual({
      type: "session.mark_read",
      messageId: "assistant-message-1",
    });
  });
});
