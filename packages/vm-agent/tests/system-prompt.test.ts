import { describe, expect, it } from "vitest";
import { buildSystemPromptAppend } from "../src/system-prompt";

describe("buildSystemPromptAppend", () => {
  it("includes sprite context and branch naming instructions", () => {
    const prompt = buildSystemPromptAppend("abcd", "Sprite-specific context");

    expect(prompt).toContain("Sprite-specific context");
    expect(prompt).toContain("cloude/<descriptive-slug>-abcd");
    expect(prompt).toContain("NEVER push to `main`");
  });
});
