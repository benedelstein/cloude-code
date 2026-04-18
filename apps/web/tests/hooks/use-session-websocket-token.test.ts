import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionWebSocketToken } from "@/hooks/use-session-websocket-token";

const {
  MockApiError,
  createSessionWebSocketToken,
  consumeInitialSessionWebSocketToken,
} = vi.hoisted(() => {
  class MockApiError extends Error {
    public status: number;
    public code?: string;

    constructor(
      message: string,
      status: number,
      code?: string,
    ) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  return {
    MockApiError,
    createSessionWebSocketToken: vi.fn(),
    consumeInitialSessionWebSocketToken: vi.fn(),
  };
});

vi.mock("@/lib/client-api", () => ({
  ApiError: MockApiError,
  createSessionWebSocketToken,
}));

vi.mock("@/lib/session-websocket-token", () => ({
  consumeInitialSessionWebSocketToken,
}));

function makeToken(expiresAt: string) {
  return {
    token: `token-${expiresAt}`,
    expiresAt,
  };
}

function createDeferred<T>() {
  return Promise.withResolvers<T>();
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useSessionWebSocketToken", () => {
  beforeEach(() => {
    createSessionWebSocketToken.mockReset();
    consumeInitialSessionWebSocketToken.mockReset();
  });

  it("uses the cached initial token without fetching immediately", async () => {
    const token = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());
    consumeInitialSessionWebSocketToken.mockReturnValue(token);

    const { result } = renderHook(() => useSessionWebSocketToken({
      sessionId: "session-1",
    }));

    expect(result.current.token).toEqual(token);

    await act(async () => {
      await flushMicrotasks();
    });

    expect(createSessionWebSocketToken).not.toHaveBeenCalled();
  });

  it("fetches when there is no initial token", async () => {
    const token = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());
    consumeInitialSessionWebSocketToken.mockReturnValue(null);
    createSessionWebSocketToken.mockResolvedValue(token);

    const { result } = renderHook(() => useSessionWebSocketToken({
      sessionId: "session-2",
    }));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.token).toEqual(token);
    expect(createSessionWebSocketToken).toHaveBeenCalledWith("session-2");
  });

  it("retries transient failures with backoff", async () => {
    vi.useFakeTimers();

    const onReconnectPending = vi.fn();
    const token = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());

    consumeInitialSessionWebSocketToken.mockReturnValue(null);
    createSessionWebSocketToken
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(token);

    const { result } = renderHook(() => useSessionWebSocketToken({
      sessionId: "session-3",
      onReconnectPending,
    }));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(createSessionWebSocketToken).toHaveBeenCalledTimes(1);
    expect(onReconnectPending).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
    });

    expect(result.current.token).toEqual(token);
    expect(createSessionWebSocketToken).toHaveBeenCalledTimes(2);
  });

  it("surfaces terminal auth errors and stops retrying", async () => {
    const onAuthError = vi.fn();

    consumeInitialSessionWebSocketToken.mockReturnValue(null);
    createSessionWebSocketToken.mockRejectedValue(
      new MockApiError("denied", 403, "AUTH_DENIED"),
    );

    const { result } = renderHook(() => useSessionWebSocketToken({
      sessionId: "session-4",
      onAuthError,
    }));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(onAuthError).toHaveBeenCalledWith({
      message: "denied",
      code: "AUTH_DENIED",
    });
    expect(result.current.token).toBeNull();
    expect(createSessionWebSocketToken).toHaveBeenCalledTimes(1);
  });

  it("does not fetch proactively while a token is still present", async () => {
    vi.useFakeTimers();

    const firstToken = makeToken(new Date(Date.now() + 90_000).toISOString());
    consumeInitialSessionWebSocketToken.mockReturnValue(firstToken);

    const { result } = renderHook(() => useSessionWebSocketToken({
      sessionId: "session-5",
    }));

    expect(result.current.token).toEqual(firstToken);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await flushMicrotasks();
    });

    expect(createSessionWebSocketToken).not.toHaveBeenCalled();
    expect(result.current.token).toEqual(firstToken);
  });

  it("refresh() fetches a new token and swaps it in", async () => {
    const firstToken = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());
    const secondToken = makeToken(new Date(Date.now() + 10 * 60_000).toISOString());

    consumeInitialSessionWebSocketToken.mockReturnValue(firstToken);
    createSessionWebSocketToken.mockResolvedValue(secondToken);

    const { result } = renderHook(() => useSessionWebSocketToken({
      sessionId: "session-5b",
    }));

    expect(result.current.token).toEqual(firstToken);

    await act(async () => {
      result.current.refresh();
      await flushMicrotasks();
    });

    expect(createSessionWebSocketToken).toHaveBeenCalledWith("session-5b");
    expect(result.current.token).toEqual(secondToken);
  });

  it("deduplicates in-flight requests for the same session", async () => {
    const deferred = createDeferred<ReturnType<typeof makeToken>>();
    const onReconnectRecovered = vi.fn();

    consumeInitialSessionWebSocketToken.mockReturnValue(null);
    createSessionWebSocketToken.mockReturnValue(deferred.promise);

    const firstHook = renderHook(() => useSessionWebSocketToken({
      sessionId: "session-6",
      onReconnectRecovered,
    }));
    const secondHook = renderHook(() => useSessionWebSocketToken({
      sessionId: "session-6",
      onReconnectRecovered,
    }));

    await waitFor(() => {
      expect(createSessionWebSocketToken).toHaveBeenCalledTimes(1);
    });

    const token = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());
    await act(async () => {
      deferred.resolve(token);
      await deferred.promise;
    });

    await waitFor(() => {
      expect(firstHook.result.current.token).toEqual(token);
      expect(secondHook.result.current.token).toEqual(token);
    });

    expect(onReconnectRecovered).toHaveBeenCalledTimes(2);
  });
});
