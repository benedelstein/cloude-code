/**
 * Optional ISO timestamps stamped onto reasoning and tool parts by
 * `MessageAccumulator`. Both fields are optional so historical records
 * (persisted before timing was added) round-trip cleanly.
 */
export interface PartTiming {
  startedAt?: string;
  endedAt?: string;
}

/**
 * Same shape as `PartTiming`, applied to `UIMessage["metadata"]` to capture
 * when the assistant message started and ended.
 */
export type MessageTiming = PartTiming;

export interface ParsedPartTiming {
  startedAt?: number;
  endedAt?: number;
}

/**
 * Read `startedAt` / `endedAt` from any part-like object without forcing a cast
 * at the call site. Returns an empty object when the input is not an object or
 * has no timing fields.
 */
export function getPartTiming(part: unknown): ParsedPartTiming {
  if (!part || typeof part !== "object") {
    return {};
  }
  const candidate = part as { startedAt?: unknown; endedAt?: unknown };
  const result: ParsedPartTiming = {};
  const startedAt = timestampToMs(candidate.startedAt);
  if (startedAt !== undefined) {
    result.startedAt = startedAt;
  }
  const endedAt = timestampToMs(candidate.endedAt);
  if (endedAt !== undefined) {
    result.endedAt = endedAt;
  }
  return result;
}

/**
 * Converts current ISO timestamps, plus legacy epoch-millisecond values, into
 * milliseconds for duration math at display boundaries.
 */
export function timestampToMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? undefined : milliseconds;
}
