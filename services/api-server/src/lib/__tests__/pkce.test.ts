import { describe, expect, it } from "vitest";
import { computeCodeChallenge, generateCodeVerifier } from "../pkce";

describe("pkce", () => {
  it("creates verifier with expected length and url-safe chars", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it("creates unique verifiers", () => {
    const first = generateCodeVerifier();
    const second = generateCodeVerifier();
    expect(first).not.toBe(second);
  });

  it("computes deterministic challenge", async () => {
    const verifier = "abc123";
    const first = await computeCodeChallenge(verifier);
    const second = await computeCodeChallenge(verifier);
    expect(first).toBe(second);
  });
});
