/**
 * Optional epoch-millisecond timestamps stamped onto reasoning and tool parts
 * by `MessageAccumulator`. Both fields are optional so historical records
 * (persisted before timing was added) round-trip cleanly.
 */
export interface PartTiming {
  startedAt?: number;
  endedAt?: number;
}

/**
 * Same shape as `PartTiming`, applied to `UIMessage["metadata"]` to capture
 * when the assistant message started and ended.
 */
export type MessageTiming = PartTiming;

/**
 * Read `startedAt` / `endedAt` from any part-like object without forcing a cast
 * at the call site. Returns an empty object when the input is not an object or
 * has no timing fields.
 */
export function getPartTiming(part: unknown): PartTiming {
  if (!part || typeof part !== "object") {
    return {};
  }
  const candidate = part as { startedAt?: unknown; endedAt?: unknown };
  const result: PartTiming = {};
  if (typeof candidate.startedAt === "number") {
    result.startedAt = candidate.startedAt;
  }
  if (typeof candidate.endedAt === "number") {
    result.endedAt = candidate.endedAt;
  }
  return result;
}
