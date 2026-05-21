import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSettings } from "@repo/shared";

const mockState = vi.hoisted(() => ({
  streamText: vi.fn(),
  readFileSync: vi.fn(() => "Sprite context\n"),
}));

vi.mock("ai", () => ({
  streamText: mockState.streamText,
}));

vi.mock("fs", () => ({
  readFileSync: mockState.readFileSync,
}));

import { WebhookAgentRunner } from "../src/webhook-agent-runner";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitFor(
  predicate: () => boolean,
  attempts = 50,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for expected condition");
}

describe("WebhookAgentRunner", () => {
  const settings: AgentSettings = {
    provider: "openai-codex",
    model: "gpt-5.3-codex",
    maxTokens: 8192,
  };

  let originalFetch: typeof fetch;

  beforeEach(() => {
    mockState.streamText.mockReset();
    mockState.readFileSync.mockReset();
    mockState.readFileSync.mockReturnValue("Sprite context\n");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not let a queued next turn lose its user message id while the prior turn drains", async () => {
    const firstChunkPostStarted = createDeferred();
    const releaseFirstChunkPost = createDeferred();
    const chunkPosts: Array<{ userMessageId: string }> = [];

    globalThis.fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/chunks")) {
        const body = JSON.parse(String(init?.body));
        chunkPosts.push(body);
        if (chunkPosts.length === 1) {
          firstChunkPostStarted.resolve();
          await releaseFirstChunkPost.promise;
        }
      }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    let turn = 0;
    mockState.streamText.mockImplementation(() => {
      turn += 1;
      return {
        toUIMessageStream: async function* () {
          yield {
            type: "finish",
            finishReason: turn === 1 ? "stop" : "unknown",
          };
        },
      };
    });

    const runner = new WebhookAgentRunner({
      config: {
        setup: async () => ({
          modelId: "gpt-5.3-codex" as const,
          getModel: () => ({ provider: "mock-model" }),
        }),
      },
      settings,
      webhookUrl: "https://worker.test/webhook",
      webhookToken: "token",
      onShutdown: () => {},
    });

    runner.queueMessage("user-message-1", { content: "first" });
    await firstChunkPostStarted.promise;

    runner.queueMessage("user-message-2", { content: "second" });
    releaseFirstChunkPost.resolve();

    await waitFor(() =>
      chunkPosts.some((post) => post.userMessageId === "user-message-2"),
    );

    expect(chunkPosts.map((post) => post.userMessageId)).toContain("user-message-1");
    expect(chunkPosts.map((post) => post.userMessageId)).toContain("user-message-2");

    await runner.shutdown();
  });

  it("acks a scoped cancel only when the requested turn is queued or running", async () => {
    const releaseStream = createDeferred();
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    mockState.streamText.mockImplementation(() => ({
      toUIMessageStream: async function* () {
        await releaseStream.promise;
        yield { type: "finish", finishReason: "stop" };
      },
    }));

    const runner = new WebhookAgentRunner({
      config: {
        setup: async () => ({
          modelId: "gpt-5.3-codex" as const,
          getModel: () => ({ provider: "mock-model" }),
        }),
      },
      settings,
      webhookUrl: "https://worker.test/webhook",
      webhookToken: "token",
      onShutdown: () => {},
    });

    runner.queueMessage("user-message-1", { content: "first" });
    await waitFor(() => mockState.streamText.mock.calls.length === 1);

    runner.cancelTurn("different-message");
    expect(stdoutWrite).not.toHaveBeenCalledWith(
      expect.stringContaining('"cancel_ack"'),
    );

    runner.cancelTurn("user-message-1");
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('"type":"cancel_ack"'),
    );
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('"userMessageId":"user-message-1"'),
    );

    releaseStream.resolve();
    await runner.shutdown();
  });

  it("removes a queued turn when scoped cancel is acknowledged", async () => {
    const releaseFirstTurn = createDeferred();
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    mockState.streamText.mockImplementation(() => ({
      toUIMessageStream: async function* () {
        await releaseFirstTurn.promise;
        yield { type: "finish", finishReason: "stop" };
      },
    }));

    const runner = new WebhookAgentRunner({
      config: {
        setup: async () => ({
          modelId: "gpt-5.3-codex" as const,
          getModel: () => ({ provider: "mock-model" }),
        }),
      },
      settings,
      webhookUrl: "https://worker.test/webhook",
      webhookToken: "token",
      onShutdown: () => {},
    });

    runner.queueMessage("user-message-1", { content: "first" });
    await waitFor(() => mockState.streamText.mock.calls.length === 1);

    runner.queueMessage("user-message-2", { content: "second" });
    runner.cancelTurn("user-message-2");

    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('"userMessageId":"user-message-2"'),
    );

    releaseFirstTurn.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockState.streamText).toHaveBeenCalledTimes(1);

    await runner.shutdown();
  });

  it("emits process heartbeats while active and idle", async () => {
    const log = vi.fn();
    const releaseStream = createDeferred();

    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

    mockState.streamText.mockImplementation(() => ({
      toUIMessageStream: async function* () {
        await releaseStream.promise;
        yield { type: "finish", finishReason: "stop" };
      },
    }));

    const runner = new WebhookAgentRunner({
      config: {
        setup: async () => ({
          modelId: "gpt-5.3-codex" as const,
          getModel: () => ({ provider: "mock-model" }),
        }),
      },
      settings,
      webhookUrl: "https://worker.test/webhook",
      webhookToken: "token",
      heartbeatIntervalMs: 5,
      onShutdown: () => {},
      logger: log,
    });

    runner.queueMessage("user-message-1", { content: "first" });
    await waitFor(() => mockState.streamText.mock.calls.length === 1);

    await waitFor(() =>
      log.mock.calls.some(
        ([level, message, meta]) =>
          level === "debug" &&
          message === "emit event -> /events" &&
          meta?.type === "heartbeat",
      ),
    );
    const activeHeartbeatCount = log.mock.calls.filter(
      ([, message, meta]) =>
        message === "emit event -> /events" && meta?.type === "heartbeat",
    ).length;

    releaseStream.resolve();

    await waitFor(
      () =>
        log.mock.calls.filter(
          ([, message, meta]) =>
            message === "emit event -> /events" && meta?.type === "heartbeat",
        ).length > activeHeartbeatCount,
    );

    await runner.shutdown();
  });
});
