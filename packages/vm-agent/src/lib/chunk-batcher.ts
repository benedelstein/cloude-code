/**
 * Bounded-age + bounded-size chunk batcher. Terminal chunks force a sync
 * flush. Flushes are serialized on an in-flight promise chain so network
 * reordering cannot swap batches at the DO.
 */
import type { UIMessageChunk } from "@repo/shared";

export interface ChunkBatchItem {
  sequence: number;
  chunk: UIMessageChunk;
}

export interface ChunkBatcherOptions {
  maxChunks: number;
  maxAgeMs: number;
  flush: (_batch: ChunkBatchItem[]) => Promise<void>;
}

/**
 * Returns true if the chunk should force an immediate flush. Terminal chunks
 * complete a turn and should reach the DO without waiting for the age timer.
 */
export function isTerminalChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === "finish" || chunk.type === "abort";
}

export class ChunkBatcher {
  private buffer: ChunkBatchItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  // in-flight flushes are serialized to preserve order on the wire
  private flushChain: Promise<void> = Promise.resolve();

  constructor(private readonly opts: ChunkBatcherOptions) {}

  add(chunk: UIMessageChunk): void {
    this.buffer.push({ sequence: this.sequence++, chunk });

    if (isTerminalChunk(chunk) || this.buffer.length >= this.opts.maxChunks) {
      this.flushNow();
      return;
    }

    if (!this.timer) {
      // bounded-age: timer starts when the first chunk lands in an empty
      // buffer, and is NOT reset on subsequent arrivals.
      this.timer = setTimeout(() => this.flushNow(), this.opts.maxAgeMs);
    }
  }

  flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return this.flushChain;
    const batch = this.buffer;
    this.buffer = [];
    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(() => this.opts.flush(batch));
    return this.flushChain;
  }
}
