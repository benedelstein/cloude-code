"use client";

import { useEffect, useState } from "react";

/**
 * Returns `Date.now()` updated on the given interval. Used to drive ticking
 * duration displays for in-flight reasoning and turn-level work headers.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}
