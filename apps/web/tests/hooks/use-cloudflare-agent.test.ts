import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ClientState } from "@repo/shared";
import { useCloudflareAgent } from "@/hooks/use-cloudflare-agent";

const mockAgentState = vi.hoisted(() => ({
  send: vi.fn(),
  options: null as null | {
    onMessage: (_event: { data: string }) => void;
    onStateUpdate: (_state: ClientState) => void;
  },
}));

vi.mock("agents/react", () => ({
  useAgent: vi.fn((options) => {
    mockAgentState.options = options;
    return { send: mockAgentState.send };
  }),
}));

function renderAgent() {
  return renderHook(() =>
    useCloudflareAgent({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      webSocketToken: {
        token: "token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    }),
  );
}

function createClientState(activeTurn: ClientState["activeTurn"]): ClientState {
  return {
    repoFullName: "ben/repo",
    status: "ready",
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
    createdAt: new Date(),
  };
}

describe("useCloudflareAgent", () => {
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
});
