import { describe, expect, it } from "vitest";
import { MessageAccumulator } from "@repo/shared";

describe("MessageAccumulator", () => {
  it("accumulates text, reasoning, and tool output flows", () => {
    const accumulator = new MessageAccumulator();

    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "text-start", id: "t1" });
    accumulator.process({ type: "text-delta", id: "t1", delta: "hello" });
    accumulator.process({ type: "text-end", id: "t1" });
    accumulator.process({ type: "reasoning-start", id: "r1" });
    accumulator.process({ type: "reasoning-delta", id: "r1", delta: "think" });
    accumulator.process({ type: "reasoning-end", id: "r1" });
    accumulator.process({ type: "tool-input-start", toolCallId: "call1", toolName: "calc" });
    accumulator.process({ type: "tool-input-available", toolCallId: "call1", toolName: "calc", input: { x: 1 } });
    accumulator.process({ type: "tool-output-available", toolCallId: "call1", output: { y: 2 } });

    const result = accumulator.process({ type: "finish" });
    expect(result.finishedMessage).toBeTruthy();
    expect(result.finishedMessage?.parts.map((part) => part.type)).toEqual([
      "text",
      "reasoning",
      "dynamic-tool",
    ]);
  });

  it("orders parts by start time when a tool completes before an earlier text ends", () => {
    // Mirrors codex provider behavior: first text remains open while the tool
    // streams and completes, then text-end arrives, then a second text.
    const accumulator = new MessageAccumulator();

    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "start-step" });
    accumulator.process({ type: "text-start", id: "t1" });
    accumulator.process({ type: "text-delta", id: "t1", delta: "Text before the tool call." });
    accumulator.process({ type: "tool-input-start", toolCallId: "c1", toolName: "exec" });
    accumulator.process({ type: "tool-input-available", toolCallId: "c1", toolName: "exec", input: { cmd: "ls" } });
    accumulator.process({ type: "tool-output-available", toolCallId: "c1", output: { stdout: "" } });
    accumulator.process({ type: "text-end", id: "t1" });
    accumulator.process({ type: "text-start", id: "t2" });
    accumulator.process({ type: "text-delta", id: "t2", delta: "Text after the tool call." });
    accumulator.process({ type: "text-end", id: "t2" });

    const result = accumulator.process({ type: "finish" });
    expect(result.finishedMessage?.parts.map((part) => part.type)).toEqual([
      "step-start",
      "text",
      "dynamic-tool",
      "text",
    ]);
    const parts = result.finishedMessage!.parts;
    expect((parts[1] as { text: string }).text).toBe("Text before the tool call.");
    expect((parts[3] as { text: string }).text).toBe("Text after the tool call.");
  });

  it("finalizes in-flight parts in start order on forceAbort", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "text-start", id: "t1" });
    accumulator.process({ type: "text-delta", id: "t1", delta: "partial" });
    accumulator.process({ type: "tool-input-start", toolCallId: "c1", toolName: "exec" });
    accumulator.process({ type: "tool-input-delta", toolCallId: "c1", inputTextDelta: "{\"a\":1}" });

    const aborted = accumulator.forceAbort();
    expect(aborted?.parts.map((part) => part.type)).toEqual(["text", "dynamic-tool"]);
    expect((aborted!.parts[0] as { text: string }).text).toBe("partial");
    expect((aborted!.parts[1] as { input: unknown }).input).toEqual({ a: 1 });
  });

  it("marks aborted metadata", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "text-start", id: "t1" });
    accumulator.process({ type: "text-delta", id: "t1", delta: "hello" });
    const result = accumulator.process({ type: "abort" });
    expect(result.finishedMessage?.metadata).toMatchObject({ aborted: true });
  });

  it("resets state", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "finish" });
    expect(accumulator.isFinished()).toBe(true);

    accumulator.reset();
    expect(accumulator.isFinished()).toBe(false);
    expect(accumulator.getPendingChunks()).toBeUndefined();
    expect(accumulator.getMessageId()).toBeNull();
  });
});
