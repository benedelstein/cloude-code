import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "@repo/shared";
import { useUserSessionsWebSocket } from "@/hooks/use-user-sessions-websocket";

const {
  refreshWebSocketToken,
  useUserSessionsWebSocketToken,
  tokenState,
} = vi.hoisted(() => ({
  refreshWebSocketToken: vi.fn(),
  tokenState: {
    token: {
      token: "stream-token",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    } as { token: string; expiresAt: string } | null,
  },
  useUserSessionsWebSocketToken: vi.fn(() => ({
    token: tokenState.token,
    refresh: refreshWebSocketToken,
  })),
}));

vi.mock("@/lib/client-api", () => ({
  WS_API_URL: "https://api.example",
}));

vi.mock("@/hooks/use-user-sessions-websocket-token", () => ({
  useUserSessionsWebSocketToken,
}));

class FakeWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static readonly instances: FakeWebSocket[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public readyState = FakeWebSocket.CONNECTING;
  public readonly sent: string[] = [];
  public close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(message: string): void {
    this.sent.push(message);
  }
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: overrides.id ?? "123e4567-e89b-12d3-a456-426614174000",
    repoId: overrides.repoId ?? 100,
    repoFullName: overrides.repoFullName ?? "acme/repo",
    title: overrides.title ?? "Session title",
    archived: overrides.archived ?? false,
    workingState: overrides.workingState ?? "idle",
    pushedBranch: overrides.pushedBranch ?? null,
    pullRequest: overrides.pullRequest ?? null,
    createdAt: overrides.createdAt ?? "2026-05-22T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-22T00:00:00.000Z",
    lastMessageAt: overrides.lastMessageAt ?? "2026-05-22T00:00:00.000Z",
  };
}

function renderUserSessionsWebSocket() {
  const callbacks = {
    onSessionUpdated: vi.fn(),
    onSessionRemoved: vi.fn(),
    onResyncRequired: vi.fn(),
    onAuthError: vi.fn(),
  };
  renderHook(() => useUserSessionsWebSocket({
    enabled: true,
    ...callbacks,
  }));
  return callbacks;
}

function emitMessage(webSocket: FakeWebSocket, data: unknown): void {
  webSocket.onmessage?.({
    data: typeof data === "string" ? data : JSON.stringify(data),
  } as MessageEvent);
}

describe("useUserSessionsWebSocket", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    FakeWebSocket.instances.length = 0;
    refreshWebSocketToken.mockReset();
    useUserSessionsWebSocketToken.mockClear();
    tokenState.token = {
      token: "stream-token",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  });

  it("connects to the user sessions stream URL with the minted token", async () => {
    renderUserSessionsWebSocket();

    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    expect(FakeWebSocket.instances[0]?.url).toBe(
      "wss://api.example/sessions/updates?token=stream-token",
    );
  });

  it("closes a connecting websocket on cleanup", async () => {
    const callbacks = {
      onSessionUpdated: vi.fn(),
      onSessionRemoved: vi.fn(),
      onResyncRequired: vi.fn(),
      onAuthError: vi.fn(),
    };
    const { unmount } = renderHook(() => useUserSessionsWebSocket({
      enabled: true,
      ...callbacks,
    }));
    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    const webSocket = FakeWebSocket.instances[0]!;
    act(() => {
      unmount();
    });

    expect(webSocket.close).toHaveBeenCalledTimes(1);
    expect(callbacks.onResyncRequired).not.toHaveBeenCalled();
  });

  it("does not reconnect when callback identities change", async () => {
    const renderOptions = () => ({
      enabled: true,
      onSessionUpdated: vi.fn(),
      onSessionRemoved: vi.fn(),
      onResyncRequired: vi.fn(),
      onAuthError: vi.fn(),
    });
    const { rerender } = renderHook(
      (options) => useUserSessionsWebSocket(options),
      { initialProps: renderOptions() },
    );
    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    rerender(renderOptions());

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.close).not.toHaveBeenCalled();
  });

  it("dispatches update, remove, and resync messages", async () => {
    const callbacks = renderUserSessionsWebSocket();
    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    const webSocket = FakeWebSocket.instances[0]!;
    const session = makeSession({ workingState: "responding" });
    act(() => {
      emitMessage(webSocket, {
        type: "session.summary.updated",
        session,
      });
      emitMessage(webSocket, {
        type: "session.summary.removed",
        sessionId: session.id,
      });
      emitMessage(webSocket, {
        type: "session.list.resync_required",
      });
      emitMessage(webSocket, "{bad json");
      emitMessage(webSocket, { type: "unknown" });
    });

    expect(callbacks.onSessionUpdated).toHaveBeenCalledWith(session);
    expect(callbacks.onSessionRemoved).toHaveBeenCalledWith(session.id);
    expect(callbacks.onResyncRequired).toHaveBeenCalledTimes(1);
  });

  it("resyncs on close, reconnects, and resyncs again after reconnect opens", async () => {
    const callbacks = renderUserSessionsWebSocket();
    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    vi.useFakeTimers();

    act(() => {
      FakeWebSocket.instances[0]?.onopen?.();
      FakeWebSocket.instances[0]?.onclose?.({} as CloseEvent);
    });

    expect(callbacks.onResyncRequired).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    act(() => {
      FakeWebSocket.instances[1]?.onopen?.();
    });
    expect(callbacks.onResyncRequired).toHaveBeenCalledTimes(2);
  });

  it("refreshes the token instead of reconnecting when the token is expired", async () => {
    tokenState.token = {
      token: "expired-token",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const callbacks = renderUserSessionsWebSocket();
    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    act(() => {
      FakeWebSocket.instances[0]?.onclose?.({} as CloseEvent);
    });

    expect(callbacks.onResyncRequired).toHaveBeenCalledTimes(1);
    expect(refreshWebSocketToken).toHaveBeenCalledTimes(1);
  });

  it("resyncs when the tab returns to visible", async () => {
    const callbacks = renderUserSessionsWebSocket();
    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(callbacks.onResyncRequired).toHaveBeenCalledTimes(1);
  });
});
