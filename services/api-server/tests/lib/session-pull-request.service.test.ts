import { describe, expect, it, vi } from "vitest";
import { failure, success } from "@repo/shared";
import {
  createPullRequestForSessionContext,
  type SessionPullRequestGitHubProvider,
} from "../../src/modules/sessions/services/session-pull-request.service";

describe("createPullRequestForSessionContext", () => {
  it("returns the pull request returned by GitHub", async () => {
    const github: SessionPullRequestGitHubProvider = {
      compareBranches: vi.fn<SessionPullRequestGitHubProvider["compareBranches"]>()
        .mockResolvedValue(failure({
          code: "GITHUB_API_ERROR",
          message: "Compare failed",
        })),
      createPullRequest: vi.fn<SessionPullRequestGitHubProvider["createPullRequest"]>()
        .mockResolvedValue(success({
          number: 58,
          url: "https://github.com/benedelstein/cloude-code/pull/58",
          state: "open",
          merged: false,
        })),
      getPullRequest: vi.fn<SessionPullRequestGitHubProvider["getPullRequest"]>(),
    };

    await expect(createPullRequestForSessionContext({
      github,
      anthropicApiKey: "test-key",
      repoFullName: "benedelstein/cloude-code",
      baseBranch: "main",
      headBranch: "cloude/mobile-scroll-fix-bafd",
      sessionMessages: [],
    })).resolves.toEqual({
      ok: true,
      value: {
        number: 58,
        url: "https://github.com/benedelstein/cloude-code/pull/58",
        state: "open",
      },
    });

    expect(github.createPullRequest).toHaveBeenCalledWith("benedelstein/cloude-code", {
      title: "Mobile scroll fix",
      body: "",
      head: "cloude/mobile-scroll-fix-bafd",
      base: "main",
    });
  });

  it("sanitizes control characters from the base branch before creating a pull request", async () => {
    const github: SessionPullRequestGitHubProvider = {
      compareBranches: vi.fn<SessionPullRequestGitHubProvider["compareBranches"]>()
        .mockResolvedValue(failure({
          code: "GITHUB_API_ERROR",
          message: "Compare failed",
        })),
      createPullRequest: vi.fn<SessionPullRequestGitHubProvider["createPullRequest"]>()
        .mockResolvedValue(success({
          number: 58,
          url: "https://github.com/benedelstein/cloude-code/pull/58",
          state: "open",
          merged: false,
        })),
      getPullRequest: vi.fn<SessionPullRequestGitHubProvider["getPullRequest"]>(),
    };

    await createPullRequestForSessionContext({
      github,
      anthropicApiKey: "test-key",
      repoFullName: "benedelstein/cloude-code",
      baseBranch: "main \u0003",
      headBranch: "cloude/mobile-scroll-fix-bafd",
      sessionMessages: [],
    });

    expect(github.createPullRequest).toHaveBeenCalledWith("benedelstein/cloude-code", {
      title: "Mobile scroll fix",
      body: "",
      head: "cloude/mobile-scroll-fix-bafd",
      base: "main",
    });
  });

  it("includes provider details when pull request creation fails", async () => {
    const github: SessionPullRequestGitHubProvider = {
      compareBranches: vi.fn<SessionPullRequestGitHubProvider["compareBranches"]>()
        .mockResolvedValue(failure({
          code: "GITHUB_API_ERROR",
          message: "Compare failed",
        })),
      createPullRequest: vi.fn<SessionPullRequestGitHubProvider["createPullRequest"]>()
        .mockResolvedValue(failure({
          code: "GITHUB_API_ERROR",
          message: "Failed to create pull request for benedelstein/cloude-code.",
          details: "GitHub returned 422: Validation Failed: base invalid",
        })),
      getPullRequest: vi.fn<SessionPullRequestGitHubProvider["getPullRequest"]>(),
    };

    await expect(createPullRequestForSessionContext({
      github,
      anthropicApiKey: "test-key",
      repoFullName: "benedelstein/cloude-code",
      baseBranch: "main",
      headBranch: "cloude/mobile-scroll-fix-bafd",
      sessionMessages: [],
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "PULL_REQUEST_CREATE_FAILED",
        message: "Failed to create pull request",
        details:
          "GitHub returned 422: Validation Failed: base invalid (base: main, head: cloude/mobile-scroll-fix-bafd)",
      },
    });
  });
});
