import { describe, expect, it } from "vitest";
import {
  normalizePullRequestState,
} from "../../src/modules/session-agent/utils/session-agent-pull-request-state.utils";

describe("normalizePullRequestState", () => {
  it("preserves created pull request state", () => {
    expect(normalizePullRequestState({
      status: "created",
      url: "https://github.com/ben/repo/pull/1",
      number: 1,
      state: "open",
    })).toEqual({
      status: "created",
      url: "https://github.com/ben/repo/pull/1",
      number: 1,
      state: "open",
    });
  });

  it("preserves failed pull request state", () => {
    expect(normalizePullRequestState({
      status: "failed",
      error: "Failed to create pull request",
      details: "base invalid",
    })).toEqual({
      status: "failed",
      error: "Failed to create pull request",
      details: "base invalid",
    });
  });

  it("clears stale creating state", () => {
    expect(normalizePullRequestState({ status: "creating" })).toBeNull();
  });

  it("rejects invalid pull request state", () => {
    expect(normalizePullRequestState({
      status: "created",
      url: "https://github.com/ben/repo/pull/3",
      number: 3,
      state: "draft",
    })).toBeNull();
    expect(normalizePullRequestState({
      url: "https://github.com/ben/repo/pull/2",
      number: 2,
      state: "merged",
    })).toBeNull();
  });
});
