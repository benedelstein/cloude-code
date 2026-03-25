import { describe, expect, it } from "vitest";
import { MessageAccumulator } from "../../src/lib/message-accumulator";

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
