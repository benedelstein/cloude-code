import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "@repo/shared";
import { ChunkBatcher, type ChunkBatchItem } from "../src/lib/chunk-batcher";

function makeFlushSpy() {
  const calls: ChunkBatchItem[][] = [];
  const flush = vi.fn(async (batch: ChunkBatchItem[]) => {
    calls.push(batch);
  });
  return { calls, flush };
}

describe("ChunkBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes on maxChunks", async () => {
    const { calls, flush } = makeFlushSpy();
    const batcher = new ChunkBatcher({ maxChunks: 3, maxAgeMs: 1_000, flush });
    const chunk: UIMessageChunk = { type: "text-delta", textDelta: "a" } as UIMessageChunk;

    batcher.add(chunk);
    batcher.add(chunk);
    expect(flush).not.toHaveBeenCalled();
    batcher.add(chunk);
    // flushNow runs synchronously on the chain; await to settle microtasks
    await batcher.flushNow();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((b) => b.sequence)).toEqual([0, 1, 2]);
  });

  it("flushes after maxAgeMs even on slow arrival", async () => {
    const { calls, flush } = makeFlushSpy();
    const batcher = new ChunkBatcher({ maxChunks: 50, maxAgeMs: 100, flush });
    batcher.add({ type: "text-delta", textDelta: "a" } as UIMessageChunk);
    batcher.add({ type: "text-delta", textDelta: "b" } as UIMessageChunk);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    await batcher.flushNow();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.length).toBe(2);
  });

  it("does NOT reset the age timer on every new chunk", async () => {
    const { calls, flush } = makeFlushSpy();
    const batcher = new ChunkBatcher({ maxChunks: 50, maxAgeMs: 100, flush });
    batcher.add({ type: "text-delta", textDelta: "a" } as UIMessageChunk);
    vi.advanceTimersByTime(60);
    batcher.add({ type: "text-delta", textDelta: "b" } as UIMessageChunk);
    vi.advanceTimersByTime(60);
    await batcher.flushNow();
    // 60 + 60 = 120 > 100, so the timer should have fired even though
    // a second chunk arrived in between.
    expect(calls).toHaveLength(1);
  });

  it("flushes synchronously on terminal chunk", async () => {
    const { calls, flush } = makeFlushSpy();
    const batcher = new ChunkBatcher({ maxChunks: 50, maxAgeMs: 10_000, flush });
    batcher.add({ type: "text-delta", textDelta: "a" } as UIMessageChunk);
    batcher.add({ type: "finish", finishReason: "stop" } as UIMessageChunk);
    await batcher.flushNow();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.at(-1)?.chunk.type).toBe("finish");
  });

  it("assigns monotonic sequence numbers across batches", async () => {
    const { calls, flush } = makeFlushSpy();
    const batcher = new ChunkBatcher({ maxChunks: 2, maxAgeMs: 1_000, flush });
    batcher.add({ type: "text-delta", textDelta: "a" } as UIMessageChunk);
    batcher.add({ type: "text-delta", textDelta: "b" } as UIMessageChunk);
    batcher.add({ type: "text-delta", textDelta: "c" } as UIMessageChunk);
    batcher.add({ type: "text-delta", textDelta: "d" } as UIMessageChunk);
    await batcher.flushNow();
    const seqs = calls.flat().map((b) => b.sequence);
    expect(seqs).toEqual([0, 1, 2, 3]);
  });
});
