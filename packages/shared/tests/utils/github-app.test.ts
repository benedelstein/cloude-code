import { describe, expect, it } from "vitest";
import { buildGitHubAppInstallUrl } from "../../src/utils/github-app";

describe("buildGitHubAppInstallUrl", () => {
  it("builds a GitHub App installation URL from a slug", () => {
    expect(buildGitHubAppInstallUrl("cloude-code-local")).toBe(
      "https://github.com/apps/cloude-code-local/installations/new",
    );
  });
});
