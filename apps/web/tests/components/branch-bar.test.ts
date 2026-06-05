import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public code?: string,
      public details?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }

  return {
    ApiError: MockApiError,
    createPullRequest: vi.fn(),
    getPullRequestStatus: vi.fn(),
  };
});

vi.mock("@/lib/client-api", () => ({
  ApiError: mocks.ApiError,
  createPullRequest: mocks.createPullRequest,
  getPullRequestStatus: mocks.getPullRequestStatus,
}));

import { BranchBar } from "@/components/chat/branch-bar";

afterEach(() => {
  cleanup();
});

describe("BranchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("open", vi.fn());
  });

  it("shows the session base branch", () => {
    render(React.createElement(BranchBar, {
      sessionId: "session-1",
      baseBranch: "develop",
      pushedBranch: "cloude/change-abcd",
      pullRequestState: null,
    }));

    expect(screen.getByText("develop")).toBeTruthy();
  });

  it("shows pull request error details next to the create button", async () => {
    mocks.createPullRequest.mockRejectedValue(new mocks.ApiError(
      "Failed to create pull request",
      400,
      undefined,
      "GitHub returned 422: Validation Failed: base invalid (base: main, head: cloude/change-abcd)",
    ));

    render(React.createElement(BranchBar, {
      sessionId: "session-1",
      baseBranch: "main",
      pushedBranch: "cloude/change-abcd",
      pullRequestState: null,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Create PR" }));

    await waitFor(() => {
      expect(screen.getByText(/GitHub returned 422/)).toBeTruthy();
    });
  });

  it("shows pull request creation in progress from client state", () => {
    render(React.createElement(BranchBar, {
      sessionId: "session-1",
      baseBranch: "main",
      pushedBranch: "cloude/change-abcd",
      pullRequestState: { status: "creating" },
    }));

    const button = screen.getByRole("button", { name: /Creating/ });
    expect(button).toHaveProperty("disabled", true);
  });

  it("shows failed pull request state with a retry button", () => {
    render(React.createElement(BranchBar, {
      sessionId: "session-1",
      baseBranch: "main",
      pushedBranch: "cloude/change-abcd",
      pullRequestState: {
        status: "failed",
        error: "Failed to create pull request",
        details: "GitHub returned 422: Validation Failed: base invalid",
      },
    }));

    expect(screen.getByText(/GitHub returned 422/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry PR" })).toBeTruthy();
  });
});
