import { describe, expect, it } from "vitest";
import { sanitizeGitBranchName, shellQuote } from "../../src/shared/utils/git-branch";

describe("git branch utilities", () => {
  it("removes control characters and trims branch names", () => {
    expect(sanitizeGitBranchName("main \u0003")).toBe("main");
    expect(sanitizeGitBranchName("\u0000feature/test\u007F")).toBe("feature/test");
  });

  it("returns null for empty branch names after sanitizing", () => {
    expect(sanitizeGitBranchName(" \u0003 ")).toBeNull();
    expect(sanitizeGitBranchName(null)).toBeNull();
    expect(sanitizeGitBranchName(undefined)).toBeNull();
  });

  it("quotes shell arguments", () => {
    expect(shellQuote("feature/it's-fine")).toBe("'feature/it'\\''s-fine'");
  });
});
