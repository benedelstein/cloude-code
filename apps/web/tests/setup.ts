import { afterEach } from "vitest";
import { vi } from "vitest";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
});
