import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../../src/types/attachments";
import { CreateSessionRequest } from "../../src/types/api/sessions";
import { PullRequestClientState, SessionSummary } from "../../src/types/session";

describe("session api schemas", () => {
  it("rejects create-session requests without an initial message", () => {
    expect(() => CreateSessionRequest.parse({
      repoId: 1,
    })).toThrow();

    expect(() => CreateSessionRequest.parse({
      repoId: 1,
      initialMessage: {},
    })).toThrow();

    expect(() => CreateSessionRequest.parse({
      repoId: 1,
      initialMessage: { content: "   " },
    })).toThrow();
  });

  it("accepts create-session requests with text or attachments", () => {
    const attachmentId = "123e4567-e89b-12d3-a456-426614174000";

    expect(() => CreateSessionRequest.parse({
      repoId: 1,
      initialMessage: { content: "Fix the bug" },
    })).not.toThrow();

    expect(() => CreateSessionRequest.parse({
      repoId: 1,
      initialMessage: { attachmentIds: [attachmentId] },
    })).not.toThrow();
  });

  it("limits create-session initial attachments to five", () => {
    const attachmentId = "123e4567-e89b-12d3-a456-426614174000";

    expect(() => CreateSessionRequest.parse({
      repoId: 1,
      initialMessage: {
        attachmentIds: Array.from(
          { length: MAX_ATTACHMENTS_PER_MESSAGE },
          () => attachmentId,
        ),
      },
    })).not.toThrow();

    expect(() => CreateSessionRequest.parse({
      repoId: 1,
      initialMessage: {
        attachmentIds: Array.from(
          { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
          () => attachmentId,
        ),
      },
    })).toThrow();
  });

  it("accepts valid sidebar summary state", () => {
    expect(() => SessionSummary.parse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      repoId: 1,
      repoFullName: "owner/repo",
      title: "Fix sidebar",
      archived: false,
      workingState: "responding",
      pushedBranch: "cloude/fix-sidebar-abcd",
      pullRequest: {
        url: "https://github.com/owner/repo/pull/12",
        number: 12,
        state: "open",
      },
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      lastMessageAt: "2026-05-22T00:00:00.000Z",
    })).not.toThrow();
  });

  it("accepts pull request client lifecycle states", () => {
    expect(PullRequestClientState.parse({ status: "creating" })).toEqual({
      status: "creating",
    });

    expect(PullRequestClientState.parse({
      status: "failed",
      error: "Failed to create pull request",
      details: "GitHub returned 422",
    })).toEqual({
      status: "failed",
      error: "Failed to create pull request",
      details: "GitHub returned 422",
    });

    expect(PullRequestClientState.parse({
      status: "created",
      url: "https://github.com/owner/repo/pull/12",
      number: 12,
      state: "open",
    })).toEqual({
      status: "created",
      url: "https://github.com/owner/repo/pull/12",
      number: 12,
      state: "open",
    });
  });

  it("rejects invalid sidebar summary states", () => {
    expect(() => SessionSummary.parse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      repoId: 1,
      repoFullName: "owner/repo",
      title: "Fix sidebar",
      archived: false,
      workingState: "busy",
      pushedBranch: null,
      pullRequest: {
        url: "https://github.com/owner/repo/pull/12",
        number: 12,
        state: "draft",
      },
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      lastMessageAt: null,
    })).toThrow();
  });
});
