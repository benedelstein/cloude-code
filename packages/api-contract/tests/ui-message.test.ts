import { describe, expect, it } from "vitest";
import { uiMessageChunkSchema, validateUIMessages } from "ai";
import {
  validateWireCompatibleChunk,
  validateWireCompatibleMessage,
  WireUIMessageChunkSchema,
  WireUIMessagePartSchema,
  WireUIMessageSchema,
} from "../src/ui-message";

describe("AI SDK-compatible UI message wire schemas", () => {
  it("parses exact chunk variants", () => {
    expect(WireUIMessageChunkSchema.parse({
      type: "text-start",
      id: "text_1",
    })).toEqual({
      type: "text-start",
      id: "text_1",
    });

    expect(WireUIMessageChunkSchema.parse({
      type: "text-delta",
      id: "text_1",
      delta: "Hello",
    })).toEqual({
      type: "text-delta",
      id: "text_1",
      delta: "Hello",
    });

    expect(WireUIMessageChunkSchema.parse({
      type: "finish",
      finishReason: "stop",
    })).toEqual({
      type: "finish",
      finishReason: "stop",
    });
  });

  it("parses data prefix chunks", () => {
    expect(WireUIMessageChunkSchema.parse({
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
    expect(WireUIMessagePartSchema.parse({
      type: "text",
      text: "Hello",
    })).toEqual({
      type: "text",
      text: "Hello",
    });

    expect(WireUIMessagePartSchema.parse({
      type: "reasoning",
      text: "Thinking",
    })).toEqual({
      type: "reasoning",
      text: "Thinking",
    });

    expect(WireUIMessagePartSchema.parse({
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

    expect(WireUIMessagePartSchema.parse({
      type: "data-progress",
      data: { percent: 50 },
    })).toEqual({
      type: "data-progress",
      data: { percent: 50 },
    });

    expect(WireUIMessagePartSchema.parse({
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

    expect(WireUIMessageChunkSchema.parse(unknownChunk)).toEqual(unknownChunk);
    expect(WireUIMessagePartSchema.parse(unknownPart)).toEqual(unknownPart);
  });

  it("preserves additive fields on known variants", () => {
    const chunk = {
      type: "text-delta",
      id: "text_1",
      delta: "Hello",
      future: true,
    };
    const part = {
      type: "text",
      text: "Hello",
      future: { nested: true },
    };
    const message = {
      id: "msg_1",
      role: "assistant",
      parts: [part],
      future: ["value"],
    };

    expect(WireUIMessageChunkSchema.parse(chunk)).toEqual(chunk);
    expect(WireUIMessagePartSchema.parse(part)).toEqual(part);
    expect(WireUIMessageSchema.parse(message)).toEqual(message);
  });

  it("rejects malformed known variants instead of treating them as unknown", () => {
    expect(() => WireUIMessageChunkSchema.parse({
      type: "text-delta",
      id: "text_1",
    })).toThrow();

    expect(() => WireUIMessagePartSchema.parse({
      type: "text",
    })).toThrow();
  });

  it("validates wire compatibility without returning parsed output", () => {
    const chunk = {
      type: "text-delta",
      id: "text_1",
      delta: "Hello",
      future: true,
    };
    const message = {
      id: "msg_1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello", future: true }],
      future: true,
    };

    expect(validateWireCompatibleChunk(chunk)).toBeUndefined();
    expect(validateWireCompatibleMessage(message)).toBeUndefined();
    expect(() => validateWireCompatibleChunk({
      type: "text-delta",
      id: "text_1",
    })).toThrow("Chunk is not wire-compatible");
  });

  it("keeps known fixtures compatible with AI SDK validation", async () => {
    const chunk = WireUIMessageChunkSchema.parse({
      type: "text-delta",
      id: "text_1",
      delta: "Hello",
    });
    await expect(uiMessageChunkSchema().validate(chunk)).resolves.toMatchObject({
      success: true,
      value: chunk,
    });

    const message = WireUIMessageSchema.parse({
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
