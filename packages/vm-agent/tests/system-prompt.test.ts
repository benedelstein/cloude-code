import { describe, expect, it } from "vitest";
import { buildSystemPromptAppend } from "../src/system-prompt";

describe("buildSystemPromptAppend", () => {
  it("includes branch suffix, sprite context, and required tags", () => {
    const prompt = buildSystemPromptAppend("abcd", "SPRITE_CONTEXT_LINE");

    expect(prompt).toContain("<environment>");
    expect(prompt).toContain("</environment>");
    expect(prompt).toContain("<git-workflow>");
    expect(prompt).toContain("</git-workflow>");
    expect(prompt).toContain("SPRITE_CONTEXT_LINE");
    expect(prompt).toContain("cloude/<descriptive-slug>-abcd");
  });
});
