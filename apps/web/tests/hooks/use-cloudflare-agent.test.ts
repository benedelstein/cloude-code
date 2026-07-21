import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientState } from "@repo/shared";
import { aiChunksFromWire, useCloudflareAgent } from "@/hooks/use-cloudflare-agent";

const mockAgentState = vi.hoisted(() => ({
  send: vi.fn(),
  options: null as null | {
    onMessage: (_event: { data: string }) => void;
    onOpen?: () => void;
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

const mockGetSessionSetupOutput = vi.hoisted(() => vi.fn());

vi.mock("@/lib/client-api", () => ({
  getSessionSetupOutput: mockGetSessionSetupOutput,
}));

function renderAgent({
  expiresAt = new Date(Date.now() + 60_000).toISOString(),
  refreshWebSocketToken,
  onMarkRead,
  initialPendingUserMessage = null,
}: {
  expiresAt?: string;
  refreshWebSocketToken?: () => void;
  onMarkRead?: (sessionId: string, messageId: string) => void;
  initialPendingUserMessage?: import("ai").UIMessage | null;
} = {}) {
  return renderHook(() =>
    useCloudflareAgent({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      webSocketToken: {
        token: "token",
        expiresAt,
      },
      refreshWebSocketToken,
      initialPendingUserMessage,
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
    mockGetSessionSetupOutput.mockReset();
    mockGetSessionSetupOutput.mockResolvedValue(null);
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

  it("clears waiting on sync when restore has no active turn", () => {
    const { result } = renderAgent({
      initialPendingUserMessage: {
        id: "pending-user-1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    });

    expect(result.current.isResponding).toBe(true);

    act(() => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "sync.response",
          messages: [
            {
              id: "pending-user-1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            },
            {
              id: "assistant-1",
              role: "assistant",
              parts: [{ type: "text", text: "done" }],
            },
          ],
          activeTurn: null,
        }),
      });
    });

    expect(result.current.isResponding).toBe(false);
  });

  it("clears local waiting immediately when stop is pressed", () => {
    const { result } = renderAgent();

    act(() => {
      result.current.sendMessage({ content: "hello" });
    });
    expect(result.current.isResponding).toBe(true);

    act(() => {
      result.current.stop();
    });

    expect(latestSentMessage()).toEqual({ type: "operation.cancel" });
    expect(result.current.isResponding).toBe(false);
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

  it("sends a client message id and reconciles the optimistic message id on ack", () => {
    const randomUUIDSpy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("123e4567-e89b-12d3-a456-426614174099");
    const { result } = renderAgent();

    act(() => {
      result.current.sendMessage({ content: "hello" });
    });

    expect(result.current.messages[0]?.id).toBe("123e4567-e89b-12d3-a456-426614174099");
    expect(latestSentMessage()).toEqual({
      type: "chat.message",
      clientMessageId: "123e4567-e89b-12d3-a456-426614174099",
      content: "hello",
    });

    act(() => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "chat.accepted",
          clientMessageId: "123e4567-e89b-12d3-a456-426614174099",
          messageId: "server-message-1",
        }),
      });
    });

    expect(result.current.messages[0]?.id).toBe("server-message-1");
    randomUUIDSpy.mockRestore();
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

  it("uses server streaming metadata on streaming messages", async () => {
    const { result } = renderAgent();
    const startedAt = "2026-06-24T00:00:00.000Z";

    await act(async () => {
      mockAgentState.options?.onMessage({
        data: JSON.stringify({
          type: "agent.chunks",
          messageMetadata: { startedAt },
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
    expect(metadata?.startedAt).toBe(startedAt);
  });

  it("filters unknown wire chunks before AI SDK stream consumption", () => {
    expect(aiChunksFromWire([
      { type: "future-chunk", payload: true },
      { type: "text-delta", id: "text-1", delta: "hello" },
    ])).toEqual([
      { type: "text-delta", id: "text-1", delta: "hello" },
    ]);
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

  it("does not request transcript sync on socket open", () => {
    renderAgent();

    act(() => {
      mockAgentState.options?.onOpen?.();
    });

    expect(mockAgentState.send).not.toHaveBeenCalledWith(JSON.stringify({
      type: "sync.request",
    }));
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

  it("accumulates setup output chunks per stream", () => {
    const { result } = renderAgent();

    act(() => {
      emitSetupOutputChunks("epoch-1", [
        { stream: "stdout", data: "line 1\n", offset: 0 },
        { stream: "stderr", data: "warn 1\n", offset: 0 },
      ]);
      emitSetupOutputChunks("epoch-1", [
        { stream: "stdout", data: "line 2\n", offset: 7 },
      ]);
    });

    expect(result.current.setupScriptOutput).toEqual({
      epoch: "epoch-1",
      stdout: "line 1\nline 2\n",
      stderr: "warn 1\n",
    });
  });

  it("resets accumulated setup output when the epoch changes", () => {
    const { result } = renderAgent();

    act(() => {
      emitSetupOutputChunks("epoch-1", [
        { stream: "stdout", data: "old run\n", offset: 0 },
      ]);
      emitSetupOutputChunks("epoch-2", [
        { stream: "stdout", data: "new run\n", offset: 0 },
      ]);
    });

    expect(result.current.setupScriptOutput).toEqual({
      epoch: "epoch-2",
      stdout: "new run\n",
      stderr: "",
    });
  });

  it("drops gap chunks and resyncs from the fetch endpoint", async () => {
    mockGetSessionSetupOutput.mockResolvedValue({
      taskId: "setup_script",
      epoch: "epoch-1",
      stdout: "line 1\nline 2\n",
      stderr: "",
      truncated: false,
      completed: false,
    });
    const { result } = renderAgent();

    await act(async () => {
      // Joined mid-run: this chunk starts past the applied prefix.
      emitSetupOutputChunks("epoch-1", [
        { stream: "stdout", data: "line 2\n", offset: 7 },
      ]);
    });

    expect(mockGetSessionSetupOutput).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000",
    );
    expect(result.current.setupScriptOutput).toEqual({
      epoch: "epoch-1",
      stdout: "line 1\nline 2\n",
      stderr: "",
    });
  });

  it("dedupes streamed chunks already covered by a hydrated snapshot", () => {
    const { result } = renderAgent();

    act(() => {
      result.current.hydrateSetupOutput({
        taskId: "setup_script",
        epoch: "epoch-1",
        stdout: "line 1\nline 2\n",
        stderr: "",
        truncated: false,
        completed: false,
      });
      // Fully covered by the snapshot — must not duplicate.
      emitSetupOutputChunks("epoch-1", [
        { stream: "stdout", data: "line 2\n", offset: 7 },
      ]);
      // Overlaps the snapshot tail — only the unseen part applies.
      emitSetupOutputChunks("epoch-1", [
        { stream: "stdout", data: "line 2\nline 3\n", offset: 7 },
      ]);
    });

    expect(result.current.setupScriptOutput).toEqual({
      epoch: "epoch-1",
      stdout: "line 1\nline 2\nline 3\n",
      stderr: "",
    });
  });

  it("replaces accumulated setup output when hydrating a different epoch", () => {
    const { result } = renderAgent();

    act(() => {
      emitSetupOutputChunks("epoch-1", [
        { stream: "stdout", data: "stale\n", offset: 0 },
      ]);
      result.current.hydrateSetupOutput({
        taskId: "setup_script",
        epoch: "epoch-2",
        stdout: "fresh\n",
        stderr: "warn\n",
        truncated: false,
        completed: true,
      });
    });

    expect(result.current.setupScriptOutput).toEqual({
      epoch: "epoch-2",
      stdout: "fresh\n",
      stderr: "warn\n",
    });
  });
});

function emitSetupOutputChunks(
  epoch: string,
  chunks: Array<{ stream: "stdout" | "stderr"; data: string; offset: number }>,
): void {
  mockAgentState.options?.onMessage({
    data: JSON.stringify({
      type: "setup.output.chunks",
      taskId: "setup_script",
      epoch,
      chunks,
    }),
  });
}
