import { describe, expect, it } from "vitest";
import { QuestionRegistry } from "../src/lib/question-registry";

describe("QuestionRegistry", () => {
  it("blocks until an answer is delivered, then resolves with it", async () => {
    const registry = new QuestionRegistry();
    const pending = registry.register("q1");

    expect(registry.size).toBe(1);

    const delivered = registry.answer("q1", [
      { header: "Choice", selected: ["Option A"] },
    ]);

    expect(delivered).toBe(true);
    await expect(pending).resolves.toEqual([
      { header: "Choice", selected: ["Option A"] },
    ]);
    expect(registry.size).toBe(0);
  });

  it("returns false for unknown question ids", () => {
    const registry = new QuestionRegistry();
    expect(registry.answer("missing", [])).toBe(false);
  });

  it("rejects all pending questions on cancel/shutdown", async () => {
    const registry = new QuestionRegistry();
    const pending = registry.register("q1");

    registry.rejectAll(new Error("turn cancelled"));

    await expect(pending).rejects.toThrow("turn cancelled");
    expect(registry.size).toBe(0);
  });
});
