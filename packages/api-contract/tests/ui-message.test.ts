import { describe, expect, it } from "vitest";
import { uiMessageChunkSchema, validateUIMessages } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";
import {
  validateWireCompatibleChunk,
  validateWireCompatibleMessage,
  WireUIMessageChunkSchema,
  WireUIMessagePartSchema,
  WireUIMessageSchema,
} from "../src/ui-message";

type UIMessagePart = UIMessage["parts"][number];

const aiSdkChunkFixtures = [
  {
    name: "text-start",
    value: { type: "text-start", id: "text_1" } satisfies UIMessageChunk,
  },
  {
    name: "text-delta",
    value: { type: "text-delta", id: "text_1", delta: "Hello" } satisfies UIMessageChunk,
  },
  {
    name: "text-end",
    value: { type: "text-end", id: "text_1" } satisfies UIMessageChunk,
  },
  {
    name: "reasoning-start",
    value: { type: "reasoning-start", id: "reasoning_1" } satisfies UIMessageChunk,
  },
  {
    name: "reasoning-delta",
    value: { type: "reasoning-delta", id: "reasoning_1", delta: "Thinking" } satisfies UIMessageChunk,
  },
  {
    name: "reasoning-end",
    value: { type: "reasoning-end", id: "reasoning_1" } satisfies UIMessageChunk,
  },
  {
    name: "error",
    value: { type: "error", errorText: "failed" } satisfies UIMessageChunk,
  },
  {
    name: "tool-input-start",
    value: { type: "tool-input-start", toolCallId: "call_1", toolName: "bash" } satisfies UIMessageChunk,
  },
  {
    name: "tool-input-delta",
    value: { type: "tool-input-delta", toolCallId: "call_1", inputTextDelta: "{\"cmd\"" } satisfies UIMessageChunk,
  },
  {
    name: "tool-input-available",
    value: {
      type: "tool-input-available",
      toolCallId: "call_1",
      toolName: "bash",
      input: { cmd: "ls" },
    } satisfies UIMessageChunk,
  },
  {
    name: "tool-input-error",
    value: {
      type: "tool-input-error",
      toolCallId: "call_1",
      toolName: "bash",
      input: { cmd: "ls" },
      errorText: "invalid input",
    } satisfies UIMessageChunk,
  },
  {
    name: "tool-approval-request",
    value: { type: "tool-approval-request", approvalId: "approval_1", toolCallId: "call_1" } satisfies UIMessageChunk,
  },
  {
    name: "tool-output-available",
    value: { type: "tool-output-available", toolCallId: "call_1", output: "README.md" } satisfies UIMessageChunk,
  },
  {
    name: "tool-output-error",
    value: { type: "tool-output-error", toolCallId: "call_1", errorText: "failed" } satisfies UIMessageChunk,
  },
  {
    name: "tool-output-denied",
    value: { type: "tool-output-denied", toolCallId: "call_1" } satisfies UIMessageChunk,
  },
  {
    name: "source-url",
    value: { type: "source-url", sourceId: "source_1", url: "https://example.com" } satisfies UIMessageChunk,
  },
  {
    name: "source-document",
    value: {
      type: "source-document",
      sourceId: "source_1",
      mediaType: "text/plain",
      title: "Notes",
    } satisfies UIMessageChunk,
  },
  {
    name: "file",
    value: { type: "file", url: "https://example.com/file.txt", mediaType: "text/plain" } satisfies UIMessageChunk,
  },
  {
    name: "data",
    value: { type: "data-progress", data: { percent: 50 }, transient: true } satisfies UIMessageChunk,
  },
  {
    name: "start-step",
    value: { type: "start-step" } satisfies UIMessageChunk,
  },
  {
    name: "finish-step",
    value: { type: "finish-step" } satisfies UIMessageChunk,
  },
  {
    name: "start",
    value: { type: "start", messageId: "msg_1" } satisfies UIMessageChunk,
  },
  {
    name: "finish",
    value: { type: "finish", finishReason: "stop" } satisfies UIMessageChunk,
  },
  {
    name: "abort",
    value: { type: "abort", reason: "cancelled" } satisfies UIMessageChunk,
  },
  {
    name: "message-metadata",
    value: { type: "message-metadata", messageMetadata: { createdAt: "2026-06-15T00:00:00.000Z" } } satisfies UIMessageChunk,
  },
];

const aiSdkPartFixtures = [
  {
    name: "text",
    value: { type: "text", text: "Hello" } satisfies UIMessagePart,
  },
  {
    name: "reasoning",
    value: { type: "reasoning", text: "Thinking" } satisfies UIMessagePart,
  },
  {
    name: "source-url",
    value: { type: "source-url", sourceId: "source_1", url: "https://example.com" } satisfies UIMessagePart,
  },
  {
    name: "source-document",
    value: { type: "source-document", sourceId: "source_1", mediaType: "text/plain", title: "Notes" } satisfies UIMessagePart,
  },
  {
    name: "file",
    value: { type: "file", url: "https://example.com/file.txt", mediaType: "text/plain" } satisfies UIMessagePart,
  },
  {
    name: "step-start",
    value: { type: "step-start" } satisfies UIMessagePart,
  },
  {
    name: "data",
    value: { type: "data-progress", data: { percent: 50 } } satisfies UIMessagePart,
  },
  {
    name: "dynamic-tool",
    value: {
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { cmd: "ls" },
      output: "README.md",
    } satisfies UIMessagePart,
  },
  {
    name: "tool",
    value: {
      type: "tool-bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { cmd: "ls" },
      output: "README.md",
    } satisfies UIMessagePart,
  },
];

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

    expect(() => WireUIMessageChunkSchema.parse({
      type: "tool-input-available",
      toolCallId: "call_1",
      toolName: "bash",
    })).toThrow();

    expect(() => WireUIMessageChunkSchema.parse({
      type: "tool-output-available",
      toolCallId: "call_1",
    })).toThrow();

    expect(() => WireUIMessageChunkSchema.parse({
      type: "data-progress",
    })).toThrow();

    expect(() => WireUIMessageChunkSchema.parse({
      type: "message-metadata",
    })).toThrow();

    expect(() => WireUIMessagePartSchema.parse({
      type: "text",
    })).toThrow();

    expect(() => WireUIMessagePartSchema.parse({
      type: "data-progress",
    })).toThrow();
  });

  it.each([
    { name: "undefined", value: undefined },
    { name: "function", value: () => "not-json" },
    { name: "symbol", value: Symbol("not-json") },
    { name: "bigint", value: BigInt(1) },
    { name: "NaN", value: Number.NaN },
    { name: "Infinity", value: Number.POSITIVE_INFINITY },
    { name: "nested undefined", value: { nested: undefined } },
    { name: "nested function", value: { nested: () => "not-json" } },
  ])("rejects non-JSON payload values: $name", ({ value }) => {
    expect(() => WireUIMessageChunkSchema.parse({
      type: "tool-output-available",
      toolCallId: "call_1",
      output: value,
    })).toThrow("Expected JSON value");
  });

  it("accepts null JSON payload values", () => {
    expect(WireUIMessageChunkSchema.parse({
      type: "tool-output-available",
      toolCallId: "call_1",
      output: null,
    })).toEqual({
      type: "tool-output-available",
      toolCallId: "call_1",
      output: null,
    });
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

  it.each(aiSdkChunkFixtures)("accepts AI SDK-typed chunk fixture: $name", ({ value }) => {
    expect(validateWireCompatibleChunk(value)).toBeUndefined();
    expect(WireUIMessageChunkSchema.parse(value)).toEqual(value);
  });

  it.each(aiSdkPartFixtures)("accepts AI SDK-typed part fixture: $name", ({ value }) => {
    const message = {
      id: `msg_${value.type}`,
      role: "assistant",
      parts: [value],
    } satisfies UIMessage;

    expect(validateWireCompatibleMessage(message)).toBeUndefined();
    expect(WireUIMessageSchema.parse(message)).toEqual(message);
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
