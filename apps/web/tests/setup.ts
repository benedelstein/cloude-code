import { afterEach } from "vitest";
import { vi } from "vitest";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

// Node 24+ can expose incomplete experimental storage globals before jsdom initializes.
// Install deterministic browser-compatible storage so tests do not depend on Node flags.
const testLocalStorage = createMemoryStorage();
const testSessionStorage = createMemoryStorage();

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: testLocalStorage,
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: testSessionStorage,
});
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: testLocalStorage,
});
Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: testSessionStorage,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  testLocalStorage.clear();
  testSessionStorage.clear();
});
