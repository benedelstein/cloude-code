interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Read a cached value from localStorage.
 * Returns null if the key is missing, the data is corrupt, or localStorage is unavailable.
 */
export function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: CacheEntry<T> = JSON.parse(raw);
    if (!parsed || typeof parsed.timestamp !== "number" || !("data" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write a value into the localStorage cache.
 * Silently ignores errors (quota exceeded, private browsing, etc.).
 */
export function writeCache<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Caching is best-effort
  }
}

export const CACHE_KEY_REPOS = "cache:repos";

export function branchCacheKey(repoId: number): string {
  return `cache:branches:${repoId}`;
}
