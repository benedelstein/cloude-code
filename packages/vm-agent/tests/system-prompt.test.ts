import { describe, expect, it } from "vitest";
import { buildSystemPromptAppend } from "../src/lib/system-prompt";

describe("buildSystemPromptAppend", () => {
  it("includes sprite context, branch naming instructions, and Claude todo guidance", () => {
    const prompt = buildSystemPromptAppend("abcd", "Sprite-specific context", "TodoWrite");

    expect(prompt).toContain("Sprite-specific context");
    expect(prompt).toContain("cloude/<descriptive-slug>-abcd");
    expect(prompt).toContain("NEVER push to `main`");
    expect(prompt).toContain("`TodoWrite`");
  });

  it("mentions update_plan for Codex", () => {
    const prompt = buildSystemPromptAppend("wxyz", "Sprite-specific context", "update_plan");

    expect(prompt).toContain("`update_plan`");
  });
});
