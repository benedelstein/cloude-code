import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOutput, AgentSettings } from "@repo/shared";

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

import { startAgentHarness } from "../src/lib/agent-harness";

async function pollOutputs(
  outputs: AgentOutput[],
  predicate: (_outputs: AgentOutput[]) => boolean,
  attempts = 20,
): Promise<AgentOutput[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate(outputs)) { return outputs; }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for expected harness output");
}

describe("startAgentHarness", () => {
  const settings: AgentSettings = {
    provider: "openai-codex",
    model: "gpt-5.3-codex",
    maxTokens: 8192,
  };

  let originalSessionId: string | undefined;

  beforeEach(() => {
    mockState.streamText.mockReset();
    mockState.readFileSync.mockReset();
    mockState.readFileSync.mockReturnValue("Sprite context\n");

    originalSessionId = process.env.SESSION_ID;
    process.env.SESSION_ID = "abcd1234";
  });

  afterEach(() => {
    if (originalSessionId === undefined) {
      delete process.env.SESSION_ID;
    } else {
      process.env.SESSION_ID = originalSessionId;
    }
  });

  it("initializes once and forwards stream chunks through emit", async () => {
    const outputs: AgentOutput[] = [];
    const emit = (output: AgentOutput) => {
      outputs.push(output);
    };

    const getModel = vi.fn(() => ({ provider: "mock-model" }));
    const setup = vi.fn(async ({ sessionSuffix, spriteContext }) => {
      expect(sessionSuffix).toBe("abcd");
      expect(spriteContext).toBe("Sprite context");
      return {
        modelId: "gpt-5.3-codex" as const,
        getModel,
      };
    });

    mockState.streamText.mockImplementation(({ messages }) => ({
      toUIMessageStream: async function* ({
        generateMessageId,
      }: {
        generateMessageId: () => string;
      }) {
        expect(messages).toEqual([
          {
            role: "user",
            content: [
              { type: "text", text: "hello" },
              {
                type: "image",
                image: "data:image/png;base64,abc",
                mediaType: "image/png",
              },
            ],
          },
        ]);

        yield { type: "start", messageId: generateMessageId() };
        yield { type: "text-delta", textDelta: "hi" };
        yield { type: "finish", finishReason: "stop" };
      },
    }));

    const handle = startAgentHarness({ config: { setup }, settings, emit });

    handle.queueMessage(
      {
        content: "hello",
        attachments: [
          {
            filename: "diagram.png",
            mediaType: "image/png",
            dataUrl: "data:image/png;base64,abc",
          },
        ],
      },
      "user-message-1",
    );

    await pollOutputs(
      outputs,
      (current) =>
        current.some((output) => output.type === "ready") &&
        current.some(
          (output) =>
            output.type === "stream" &&
            (output.chunk as { type?: string } | null)?.type === "finish",
        ),
    );

    expect(outputs).toContainEqual({ type: "ready" });
    expect(outputs).toContainEqual({ type: "debug", message: "Using model: gpt-5.3-codex, agentMode: edit" });
    expect(outputs).toContainEqual({
      type: "stream",
      chunk: {
        type: "start",
        messageId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    });
    expect(outputs).toContainEqual({ type: "stream", chunk: { type: "text-delta", textDelta: "hi" } });
    expect(outputs).toContainEqual({ type: "stream", chunk: { type: "finish", finishReason: "stop" } });

    expect(setup).toHaveBeenCalledTimes(1);
    expect(getModel).toHaveBeenCalledWith("gpt-5.3-codex", { agentMode: "edit" });
    expect(mockState.streamText).toHaveBeenCalledTimes(1);

    await handle.shutdown();
  });

  it("fires onTurnStart and onTurnEnd around each turn", async () => {
    const outputs: AgentOutput[] = [];
    const emit = (output: AgentOutput) => {
      outputs.push(output);
    };
    const onTurnStart = vi.fn();
    const onTurnEnd = vi.fn();

    const setup = vi.fn(async () => ({
      modelId: "gpt-5.3-codex" as const,
      getModel: () => ({ provider: "mock-model" }),
    }));

    mockState.streamText.mockImplementation(() => ({
      toUIMessageStream: async function* () {
        yield { type: "finish", finishReason: "stop" };
      },
    }));

    const handle = startAgentHarness({
      config: { setup },
      settings,
      emit,
      onTurnStart,
      onTurnEnd,
    });

    handle.queueMessage({ content: "hi" }, "user-message-1");

    await pollOutputs(outputs, () => onTurnEnd.mock.calls.length === 1);
    expect(onTurnStart).toHaveBeenCalledWith({ content: "hi" }, "user-message-1");
    expect(onTurnEnd).toHaveBeenCalledWith({ finishReason: "stop", aborted: false });

    await handle.shutdown();
  });

  it("marks the turn aborted when cancel fires", async () => {
    const outputs: AgentOutput[] = [];
    const emit = (output: AgentOutput) => {
      outputs.push(output);
    };
    const onTurnEnd = vi.fn();

    const setup = vi.fn(async () => ({
      modelId: "gpt-5.3-codex" as const,
      getModel: () => ({ provider: "mock-model" }),
    }));

    mockState.streamText.mockImplementation(({ abortSignal }) => ({
      toUIMessageStream: async function* () {
        // Wait until the abort fires, then throw like the real streamText would.
        await new Promise<void>((resolve) => {
          if ((abortSignal as AbortSignal).aborted) {
            resolve();
            return;
          }
          (abortSignal as AbortSignal).addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        const err = new Error("aborted");
        err.name = "AbortError";
        if (false as boolean) { yield { type: "finish", finishReason: "stop" }; }
        throw err;
      },
    }));

    const handle = startAgentHarness({
      config: { setup },
      settings,
      emit,
      onTurnEnd,
    });

    handle.queueMessage({ content: "hi" }, "user-message-1");

    // Wait for ready + the stream to have started before cancelling.
    await pollOutputs(outputs, (current) => current.some((o) => o.type === "ready"));
    handle.cancelTurn();

    await pollOutputs(outputs, () => onTurnEnd.mock.calls.length === 1);
    expect(onTurnEnd).toHaveBeenCalledWith({ finishReason: "abort", aborted: true });

    await handle.shutdown();
  });

  it("treats setup failure as fatal without ending a turn", async () => {
    const outputs: AgentOutput[] = [];
    const emit = (output: AgentOutput) => {
      outputs.push(output);
    };
    const onSetupError = vi.fn();
    const onTurnEnd = vi.fn();
    const setupError = new Error("provider auth failed");
    const setup = vi.fn(async () => {
      throw setupError;
    });

    const handle = startAgentHarness({
      config: { setup },
      settings,
      emit,
      onSetupError,
      onTurnEnd,
    });

    handle.queueMessage({ content: "hi" }, "user-message-1");

    await pollOutputs(outputs, () => onSetupError.mock.calls.length === 1);

    expect(outputs).toContainEqual({ type: "error", error: String(setupError) });
    expect(onSetupError).toHaveBeenCalledWith(setupError);
    expect(onTurnEnd).not.toHaveBeenCalled();
    expect(mockState.streamText).not.toHaveBeenCalled();

    await handle.shutdown();
  });

  it("does not process queued messages after setup failure", async () => {
    const outputs: AgentOutput[] = [];
    const emit = (output: AgentOutput) => {
      outputs.push(output);
    };
    const onSetupError = vi.fn();
    const setup = vi.fn(async () => {
      throw new Error("setup failed");
    });

    const handle = startAgentHarness({
      config: { setup },
      settings,
      emit,
      onSetupError,
    });

    handle.queueMessage({ content: "first" }, "user-message-1");
    handle.queueMessage({ content: "second" }, "user-message-2");

    await pollOutputs(outputs, () => onSetupError.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setup).toHaveBeenCalledTimes(1);
    expect(mockState.streamText).not.toHaveBeenCalled();

    await handle.shutdown();
  });
});
