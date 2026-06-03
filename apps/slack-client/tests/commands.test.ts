import { describe, expect, it } from "vitest";
import { parseSlackCommand } from "../src/commands";

describe("parseSlackCommand", () => {
  it("parses a repo-scoped mention into a create-session request", () => {
    const result = parseSlackCommand(
      "<@U123> repo:123456 branch:main mode:plan fix the failing tests",
      {},
    );

    expect(result).toEqual({
      ok: true,
      command: {
        repoId: 123456,
        branch: "main",
        agentMode: "plan",
        settings: undefined,
        initialMessage: "fix the failing tests",
      },
    });
  });

  it("uses the default repo id when omitted", () => {
    const result = parseSlackCommand("<@U123> fix the failing tests", {
      defaultRepoId: 42,
    });

    expect(result).toEqual({
      ok: true,
      command: {
        repoId: 42,
        branch: undefined,
        agentMode: undefined,
        settings: undefined,
        initialMessage: "fix the failing tests",
      },
    });
  });

  it("returns help when no repo id is available", () => {
    const result = parseSlackCommand("<@U123> fix the failing tests", {});

    expect(result).toEqual({
      ok: false,
      message: "I need a repo id. Try `repo:123456 fix the failing tests`.",
    });
  });

  it("parses provider settings", () => {
    const result = parseSlackCommand(
      "<@U123> repo:123 provider:openai-codex model:gpt-5 effort:high update the docs",
      {},
    );

    expect(result).toEqual({
      ok: true,
      command: {
        repoId: 123,
        branch: undefined,
        agentMode: undefined,
        settings: {
          provider: "openai-codex",
          model: "gpt-5",
          effort: "high",
        },
        initialMessage: "update the docs",
      },
    });
  });
});
