import { describe, expect, it, vi } from "vitest";
import { failure, success } from "@repo/shared";
import {
  createPullRequestForSession,
  type SessionPullRequestGitHubProvider,
  type SessionPullRequestServiceError,
} from "../../src/modules/sessions/services/session-pull-request.service";
import type { SessionAgentRpc } from "../../src/shared/types/session-agent";

function createSessionStub() {
  const setPullRequest = vi.fn<SessionAgentRpc["setPullRequest"]>().mockResolvedValue(undefined);
  const sessionStub = {
    handleGetSession: vi.fn<SessionAgentRpc["handleGetSession"]>().mockReturnValue(success({
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      title: null,
      status: "ready",
      repoFullName: "benedelstein/cloude-code",
      baseBranch: "main",
      pushedBranch: "cloude/mobile-scroll-fix-bafd",
    })),
    handleGetMessages: vi.fn<SessionAgentRpc["handleGetMessages"]>().mockReturnValue(success([])),
    setPullRequest,
  } as unknown as SessionAgentRpc;

  return { sessionStub, setPullRequest };
}

describe("createPullRequestForSession", () => {
  it("returns and persists the pull request returned by GitHub", async () => {
    const { sessionStub, setPullRequest } = createSessionStub();
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

    await expect(createPullRequestForSession({
      sessionStub,
      github,
      anthropicApiKey: "test-key",
    })).resolves.toEqual({
      number: 58,
      url: "https://github.com/benedelstein/cloude-code/pull/58",
      state: "open",
    });

    expect(github.createPullRequest).toHaveBeenCalledWith("benedelstein/cloude-code", {
      title: "Mobile scroll fix",
      body: "",
      head: "cloude/mobile-scroll-fix-bafd",
      base: "main",
    });
    expect(setPullRequest).toHaveBeenCalledWith({
      number: 58,
      url: "https://github.com/benedelstein/cloude-code/pull/58",
      state: "open",
    });
  });

  it("includes provider details when pull request creation fails", async () => {
    const { sessionStub } = createSessionStub();
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

    await expect(createPullRequestForSession({
      sessionStub,
      github,
      anthropicApiKey: "test-key",
    })).rejects.toMatchObject({
      responseBody: {
        details: "GitHub returned 422: Validation Failed: base invalid (base: main, head: cloude/mobile-scroll-fix-bafd)",
      },
    } satisfies Partial<SessionPullRequestServiceError>);
  });
});
