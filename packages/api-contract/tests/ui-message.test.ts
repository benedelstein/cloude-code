import { describe, expect, it } from "vitest";
import { uiMessageChunkSchema, validateUIMessages } from "ai";
import { UIMessageChunkSchema } from "../src/ui-message-chunks";
import { UIMessagePartSchema } from "../src/ui-message-parts";
import { UIMessageSchema } from "../src/ui-message";

describe("AI SDK-compatible UI message wire schemas", () => {
  it("parses exact chunk variants", () => {
    expect(UIMessageChunkSchema.parse({
      type: "text-start",
      id: "text_1",
    })).toEqual({
      type: "text-start",
      id: "text_1",
    });

    expect(UIMessageChunkSchema.parse({
      type: "text-delta",
      id: "text_1",
      delta: "Hello",
    })).toEqual({
      type: "text-delta",
      id: "text_1",
      delta: "Hello",
    });

    expect(UIMessageChunkSchema.parse({
      type: "finish",
      finishReason: "stop",
    })).toEqual({
      type: "finish",
      finishReason: "stop",
    });
  });

  it("parses data prefix chunks", () => {
    expect(UIMessageChunkSchema.parse({
      type: "data-progress",
      id: "progress_1",
      data: { percent: 50 },
      transient: true,
    })).toEqual({
      type: "data-progress",
      id: "progress_1",
      data: { percent: 50 },
      transient: true,
    });
  });

  it("parses exact and prefix message parts", () => {
    expect(UIMessagePartSchema.parse({
      type: "text",
      text: "Hello",
    })).toEqual({
      type: "text",
      text: "Hello",
    });

    expect(UIMessagePartSchema.parse({
      type: "reasoning",
      text: "Thinking",
    })).toEqual({
      type: "reasoning",
      text: "Thinking",
    });

    expect(UIMessagePartSchema.parse({
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { cmd: "ls" },
      output: "README.md",
    })).toEqual({
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { cmd: "ls" },
      output: "README.md",
    });

    expect(UIMessagePartSchema.parse({
      type: "data-progress",
      data: { percent: 50 },
    })).toEqual({
      type: "data-progress",
      data: { percent: 50 },
    });

    expect(UIMessagePartSchema.parse({
      type: "tool-bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { cmd: "ls" },
      output: "README.md",
    })).toEqual({
      type: "tool-bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { cmd: "ls" },
      output: "README.md",
    });
  });

  it("preserves future unknown variants", () => {
    const unknownChunk = {
      type: "future-chunk",
      payload: { nested: [1, true, null] },
    };
    const unknownPart = {
      type: "future-part",
      payload: { nested: [1, true, null] },
    };

    expect(UIMessageChunkSchema.parse(unknownChunk)).toEqual(unknownChunk);
    expect(UIMessagePartSchema.parse(unknownPart)).toEqual(unknownPart);
  });

  it("rejects malformed known variants instead of treating them as unknown", () => {
    expect(() => UIMessageChunkSchema.parse({
      type: "text-delta",
      id: "text_1",
    })).toThrow();

    expect(() => UIMessagePartSchema.parse({
      type: "text",
    })).toThrow();
  });

  it("keeps known fixtures compatible with AI SDK validation", async () => {
    const chunk = UIMessageChunkSchema.parse({
      type: "text-delta",
      id: "text_1",
      delta: "Hello",
    });
    await expect(uiMessageChunkSchema().validate(chunk)).resolves.toMatchObject({
      success: true,
      value: chunk,
    });

    const message = UIMessageSchema.parse({
      id: "msg_1",
      role: "assistant",
      parts: [
        { type: "text", text: "Hello" },
        {
          type: "tool-bash",
          toolCallId: "call_1",
          state: "output-available",
          input: { cmd: "ls" },
          output: "README.md",
        },
      ],
    });

    await expect(validateUIMessages({ messages: [message] })).resolves.toEqual([message]);
  });
});
