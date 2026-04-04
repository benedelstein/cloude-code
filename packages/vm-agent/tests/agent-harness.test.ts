import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAgentOutput, encodeAgentInput, type AgentOutput, type AgentSettings } from "@repo/shared";

const mockState = vi.hoisted(() => ({
  lineHandler: undefined as ((line: string) => void | Promise<void>) | undefined,
  streamText: vi.fn(),
  readFileSync: vi.fn(() => "Sprite context\n"),
}));

vi.mock("ai", () => ({
  streamText: mockState.streamText,
}));

vi.mock("fs", () => ({
  readFileSync: mockState.readFileSync,
}));

vi.mock("readline", () => ({
  createInterface: vi.fn(() => ({
    on: (event: string, handler: (line: string) => void | Promise<void>) => {
      if (event === "line") {
        mockState.lineHandler = handler;
      }
    },
  })),
}));

import { runAgentHarness } from "../src/agent-harness";

function decodeOutputs(chunks: string[]): AgentOutput[] {
  return chunks.flatMap((chunk) =>
    chunk
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => decodeAgentOutput(line)),
  );
}

async function pollOutputs(
  predicate: (outputs: AgentOutput[]) => boolean,
  attempts = 20,
): Promise<AgentOutput[]> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const outputs = decodeOutputs(outputChunksForPolling);
    if (predicate(outputs)) {
      return outputs;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for expected harness output");
}

let outputChunksForPolling: string[] = [];

describe("runAgentHarness", () => {
  const settings: AgentSettings = {
    provider: "openai-codex",
    model: "gpt-5.3-codex",
    maxTokens: 8192,
  };

  let outputChunks: string[] = [];
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let stdinResumeSpy: ReturnType<typeof vi.spyOn>;
  let originalSessionId: string | undefined;

  beforeEach(() => {
    outputChunks = [];
    outputChunksForPolling = outputChunks;
    mockState.lineHandler = undefined;
    mockState.streamText.mockReset();
    mockState.readFileSync.mockReset();
    mockState.readFileSync.mockReturnValue("Sprite context\n");

    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      outputChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    stdinResumeSpy = vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);

    originalSessionId = process.env.SESSION_ID;
    process.env.SESSION_ID = "abcd1234";
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    stdinResumeSpy.mockRestore();

    if (originalSessionId === undefined) {
      delete process.env.SESSION_ID;
    } else {
      process.env.SESSION_ID = originalSessionId;
    }
  });

  it("initializes once and forwards stream chunks", async () => {
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
      toUIMessageStream: async function* () {
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

        yield { type: "text-delta", textDelta: "hi" };
        yield { type: "finish", finishReason: "stop" };
      },
    }));

    await runAgentHarness({ setup }, settings);

    expect(mockState.lineHandler).toBeDefined();

    await mockState.lineHandler!(
      encodeAgentInput({
        type: "chat",
        message: {
          content: "hello",
          attachments: [
            {
              filename: "diagram.png",
              mediaType: "image/png",
              dataUrl: "data:image/png;base64,abc",
            },
          ],
        },
      }),
    );

    const outputs = await pollOutputs(
      (currentOutputs) =>
        currentOutputs.some((output) => output.type === "ready") &&
        currentOutputs.some(
          (output) => output.type === "stream" && output.chunk && output.chunk.type === "finish",
        ),
    );

    expect(outputs).toContainEqual({ type: "ready" });
    expect(outputs).toContainEqual({ type: "debug", message: "Using model: gpt-5.3-codex, agentMode: edit" });
    expect(outputs).toContainEqual({ type: "stream", chunk: { type: "text-delta", textDelta: "hi" } });
    expect(outputs).toContainEqual({ type: "stream", chunk: { type: "finish", finishReason: "stop" } });

    expect(setup).toHaveBeenCalledTimes(1);
    expect(getModel).toHaveBeenCalledWith("gpt-5.3-codex", { agentMode: "edit" });
    expect(mockState.streamText).toHaveBeenCalledTimes(1);
  });

  it("emits an error for invalid stdin input without calling setup", async () => {
    const setup = vi.fn();

    await runAgentHarness({ setup }, settings);

    expect(mockState.lineHandler).toBeDefined();

    await mockState.lineHandler!("not-json");

    const outputs = await pollOutputs((currentOutputs) => currentOutputs[0]?.type === "error");

    expect(outputs[0]).toMatchObject({
      type: "error",
    });
    expect(outputs[0]?.type).toBe("error");
    if (outputs[0]?.type === "error") {
      expect(outputs[0].error).toContain("Invalid input:");
    }

    expect(setup).not.toHaveBeenCalled();
  });
});
