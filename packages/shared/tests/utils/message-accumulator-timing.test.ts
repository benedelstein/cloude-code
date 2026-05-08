import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageAccumulator } from "@repo/shared";

describe("MessageAccumulator timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps message-level startedAt on the first chunk", () => {
    const accumulator = new MessageAccumulator();
    const before = Date.now();
    accumulator.process({ type: "start", messageId: "m1" });
    vi.advanceTimersByTime(500);
    accumulator.process({ type: "text-start", id: "t1" });
    accumulator.process({ type: "text-end", id: "t1" });
    const result = accumulator.process({ type: "finish" });

    const metadata = result.finishedMessage!.metadata as { startedAt: number; endedAt: number };
    expect(metadata.startedAt).toBe(before);
    expect(metadata.endedAt).toBe(before + 500);
  });

  it("preserves startedAt across finish and stamps endedAt", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    const start = Date.now();
    vi.advanceTimersByTime(2_000);
    const result = accumulator.process({ type: "finish" });
    const metadata = result.finishedMessage!.metadata as { startedAt: number; endedAt: number };
    expect(metadata.startedAt).toBe(start);
    expect(metadata.endedAt).toBe(start + 2_000);
  });

  it("stamps reasoning lifecycle timing", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "reasoning-start", id: "r1" });
    const start = Date.now();
    vi.advanceTimersByTime(1_500);
    accumulator.process({ type: "reasoning-delta", id: "r1", delta: "thinking" });
    accumulator.process({ type: "reasoning-end", id: "r1" });
    const result = accumulator.process({ type: "finish" });

    const reasoning = result.finishedMessage!.parts[0] as { startedAt?: number; endedAt?: number };
    expect(reasoning.startedAt).toBe(start);
    expect(reasoning.endedAt).toBe(start + 1_500);
  });

  it("stamps tool lifecycle timing with tool-input-start", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "tool-input-start", toolCallId: "c1", toolName: "Read" });
    const start = Date.now();
    vi.advanceTimersByTime(800);
    accumulator.process({ type: "tool-input-available", toolCallId: "c1", toolName: "Read", input: { file_path: "/a" } });
    vi.advanceTimersByTime(400);
    accumulator.process({ type: "tool-output-available", toolCallId: "c1", output: "ok" });
    const result = accumulator.process({ type: "finish" });

    const tool = result.finishedMessage!.parts[0] as { startedAt?: number; endedAt?: number };
    expect(tool.startedAt).toBe(start);
    expect(tool.endedAt).toBe(start + 1_200);
  });

  it("stamps tool startedAt when tool-input-available is the first event", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    const start = Date.now();
    accumulator.process({
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "Read",
      input: { file_path: "/a" },
    });
    vi.advanceTimersByTime(300);
    accumulator.process({ type: "tool-output-available", toolCallId: "c1", output: "ok" });
    const result = accumulator.process({ type: "finish" });

    const tool = result.finishedMessage!.parts[0] as { startedAt?: number; endedAt?: number };
    expect(tool.startedAt).toBe(start);
    expect(tool.endedAt).toBe(start + 300);
  });

  it("stamps endedAt on in-flight parts during abort", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "reasoning-start", id: "r1" });
    accumulator.process({ type: "tool-input-start", toolCallId: "c1", toolName: "Bash" });
    vi.advanceTimersByTime(700);
    const result = accumulator.process({ type: "abort" });
    const reasoning = result.finishedMessage!.parts[0] as { endedAt?: number };
    const tool = result.finishedMessage!.parts[1] as { endedAt?: number };
    expect(reasoning.endedAt).toBeDefined();
    expect(tool.endedAt).toBeDefined();
    const metadata = result.finishedMessage!.metadata as { aborted: boolean; endedAt: number };
    expect(metadata.aborted).toBe(true);
    expect(metadata.endedAt).toBeDefined();
  });

  it("merges provider messageMetadata without overwriting timing", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    const start = Date.now();
    vi.advanceTimersByTime(100);
    const result = accumulator.process({
      type: "finish",
      messageMetadata: { tokensUsed: 42, startedAt: 9_999_999 },
    });
    const metadata = result.finishedMessage!.metadata as {
      startedAt: number;
      endedAt: number;
      tokensUsed: number;
    };
    expect(metadata.tokensUsed).toBe(42);
    expect(metadata.startedAt).toBe(start);
    expect(metadata.endedAt).toBe(start + 100);
  });

  it("stamps endedAt on tool-output-error", () => {
    const accumulator = new MessageAccumulator();
    accumulator.process({ type: "start", messageId: "m1" });
    accumulator.process({ type: "tool-input-start", toolCallId: "c1", toolName: "Bash" });
    accumulator.process({ type: "tool-input-available", toolCallId: "c1", toolName: "Bash", input: {} });
    vi.advanceTimersByTime(250);
    accumulator.process({ type: "tool-output-error", toolCallId: "c1", errorText: "boom" });
    const result = accumulator.process({ type: "finish" });
    const tool = result.finishedMessage!.parts[0] as { endedAt?: number; state: string };
    expect(tool.endedAt).toBeDefined();
    expect(tool.state).toBe("output-error");
  });
});
