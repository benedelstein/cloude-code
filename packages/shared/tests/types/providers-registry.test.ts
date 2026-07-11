import { describe, expect, it } from "vitest";
import { OPENAI_CODEX_PROVIDER } from "@repo/shared";

describe("provider registry", () => {
  it("exposes GPT-5.6 Codex models with Sol as the default", () => {
    expect(OPENAI_CODEX_PROVIDER.defaultModel).toBe("gpt-5.6-sol");
    expect(OPENAI_CODEX_PROVIDER.models.slice(0, 3)).toEqual([
      { id: "gpt-5.6-sol", displayName: "5.6 Sol", isDefault: true },
      { id: "gpt-5.6-terra", displayName: "5.6 Terra", isDefault: false },
      { id: "gpt-5.6-luna", displayName: "5.6 Luna", isDefault: false },
    ]);
    expect(OPENAI_CODEX_PROVIDER.models.filter((model) => model.isDefault)).toHaveLength(1);
  });
});
