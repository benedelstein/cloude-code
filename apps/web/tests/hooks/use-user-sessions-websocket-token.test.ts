import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserSessionsWebSocketToken } from "@/hooks/use-user-sessions-websocket-token";

const {
  MockApiError,
  createUserSessionsWebSocketToken,
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
    createUserSessionsWebSocketToken: vi.fn(),
  };
});

vi.mock("@/lib/client-api", () => ({
  ApiError: MockApiError,
  createUserSessionsWebSocketToken,
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

describe("useUserSessionsWebSocketToken", () => {
  beforeEach(() => {
    createUserSessionsWebSocketToken.mockReset();
  });

  it("does not fetch while disabled", async () => {
    const { result } = renderHook(() => useUserSessionsWebSocketToken({
      enabled: false,
    }));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.token).toBeNull();
    expect(createUserSessionsWebSocketToken).not.toHaveBeenCalled();
  });

  it("fetches a token when enabled", async () => {
    const token = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());
    createUserSessionsWebSocketToken.mockResolvedValue(token);

    const { result } = renderHook(() => useUserSessionsWebSocketToken({
      enabled: true,
    }));

    await waitFor(() => {
      expect(result.current.token).toEqual(token);
    });
    expect(createUserSessionsWebSocketToken).toHaveBeenCalledTimes(1);
  });

  it("does not refetch or replace refresh when callback identities change", async () => {
    const token = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());
    createUserSessionsWebSocketToken.mockResolvedValue(token);
    const renderOptions = () => ({
      enabled: true,
      onAuthError: vi.fn(),
      onReconnectPending: vi.fn(),
      onReconnectRecovered: vi.fn(),
    });

    const { result, rerender } = renderHook(
      (options) => useUserSessionsWebSocketToken(options),
      { initialProps: renderOptions() },
    );
    await waitFor(() => {
      expect(result.current.token).toEqual(token);
    });
    const refresh = result.current.refresh;

    rerender(renderOptions());

    expect(result.current.refresh).toBe(refresh);
    expect(createUserSessionsWebSocketToken).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures with backoff", async () => {
    vi.useFakeTimers();

    const onReconnectPending = vi.fn();
    const token = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());
    createUserSessionsWebSocketToken
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(token);

    const { result } = renderHook(() => useUserSessionsWebSocketToken({
      enabled: true,
      onReconnectPending,
    }));

    await act(async () => {
      await flushMicrotasks();
    });

    expect(createUserSessionsWebSocketToken).toHaveBeenCalledTimes(1);
    expect(onReconnectPending).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
    });

    expect(result.current.token).toEqual(token);
    expect(createUserSessionsWebSocketToken).toHaveBeenCalledTimes(2);
  });

  it("surfaces terminal auth errors and stops retrying", async () => {
    const onAuthError = vi.fn();
    createUserSessionsWebSocketToken.mockRejectedValue(
      new MockApiError("denied", 401, "AUTH_DENIED"),
    );

    const { result } = renderHook(() => useUserSessionsWebSocketToken({
      enabled: true,
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
    expect(createUserSessionsWebSocketToken).toHaveBeenCalledTimes(1);
  });

  it("refresh() fetches a new token", async () => {
    const firstToken = makeToken(new Date(Date.now() + 5 * 60_000).toISOString());
    const secondToken = makeToken(new Date(Date.now() + 10 * 60_000).toISOString());
    createUserSessionsWebSocketToken
      .mockResolvedValueOnce(firstToken)
      .mockResolvedValueOnce(secondToken);

    const { result } = renderHook(() => useUserSessionsWebSocketToken({
      enabled: true,
    }));

    await waitFor(() => {
      expect(result.current.token).toEqual(firstToken);
    });

    await act(async () => {
      result.current.refresh();
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.token).toEqual(secondToken);
    });
    expect(createUserSessionsWebSocketToken).toHaveBeenCalledTimes(2);
  });

  it("deduplicates in-flight requests across hook instances", async () => {
    const deferred = createDeferred<ReturnType<typeof makeToken>>();
    createUserSessionsWebSocketToken.mockReturnValue(deferred.promise);

    const firstHook = renderHook(() => useUserSessionsWebSocketToken({
      enabled: true,
    }));
    const secondHook = renderHook(() => useUserSessionsWebSocketToken({
      enabled: true,
    }));

    await waitFor(() => {
      expect(createUserSessionsWebSocketToken).toHaveBeenCalledTimes(1);
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
  });
});
