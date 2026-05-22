import { describe, expect, it } from "vitest";
import { getToolNormalizer } from "@repo/shared";

describe("getToolNormalizer", () => {
  it("returns the Claude normalizer for claude-code", () => {
    const normalizer = getToolNormalizer("claude-code");
    expect(normalizer).toBeDefined();
    expect(typeof normalizer.normalize).toBe("function");
  });

  it("returns the Codex normalizer for openai-codex", () => {
    const normalizer = getToolNormalizer("openai-codex");
    expect(normalizer).toBeDefined();
    expect(typeof normalizer.normalize).toBe("function");
  });

  it("returns a different normalizer per provider", () => {
    expect(getToolNormalizer("claude-code")).not.toBe(getToolNormalizer("openai-codex"));
  });

  it("rejects unknown ProviderId at the type level", () => {
    // @ts-expect-error - "gemini" is not a valid ProviderId
    const call = () => getToolNormalizer("gemini");
    expect(call).toThrow();
  });
});
