import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@repo/shared";
import { SessionSummaryService } from "../../src/modules/session-agent/services/session-summary.service";

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174010";
const USER_ID = "123e4567-e89b-12d3-a456-426614174001";

const noopLogger: Logger = {
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  scope: () => noopLogger,
};

async function waitFor(
  predicate: () => boolean,
  attempts = 50,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for expected condition");
}

describe("SessionSummaryService", () => {
  it("publishes invalidation only after the D1 write resolves", async () => {
    const operations: string[] = [];
    const writeDeferred = Promise.withResolvers<void>();
    const repository = {
      updateWorkingState: vi.fn(async () => {
        operations.push("write:start");
        await writeDeferred.promise;
        operations.push("write:done");
      }),
      recordAssistantTurnFinished: vi.fn(),
      markRead: vi.fn(),
      updatePushedBranch: vi.fn(),
      setPullRequest: vi.fn(),
      updatePullRequestState: vi.fn(),
    };
    const publishSessionSummaryInvalidated = vi.fn(async () => {
      operations.push("publish");
    });
    const service = new SessionSummaryService({
      repository,
      getSessionId: () => SESSION_ID,
      getUserId: () => USER_ID,
      publishSessionSummaryInvalidated,
      logger: noopLogger,
    });

    service.persistWorkingState("responding");
    await Promise.resolve();

    expect(operations).toEqual(["write:start"]);
    expect(publishSessionSummaryInvalidated).not.toHaveBeenCalled();

    writeDeferred.resolve();
    await waitFor(() => operations.length === 3);

    expect(operations).toEqual(["write:start", "write:done", "publish"]);
    expect(publishSessionSummaryInvalidated).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
    );
  });

  it("serializes summary mutations before publishing invalidations", async () => {
    const operations: string[] = [];
    const repository = {
      updateWorkingState: vi.fn(async () => {
        operations.push("working:write");
      }),
      recordAssistantTurnFinished: vi.fn(),
      markRead: vi.fn(),
      updatePushedBranch: vi.fn(async () => {
        operations.push("branch:write");
      }),
      setPullRequest: vi.fn(),
      updatePullRequestState: vi.fn(),
    };
    const publishSessionSummaryInvalidated = vi.fn(async () => {
      operations.push("publish");
    });
    const service = new SessionSummaryService({
      repository,
      getSessionId: () => SESSION_ID,
      getUserId: () => USER_ID,
      publishSessionSummaryInvalidated,
      logger: noopLogger,
    });

    service.persistWorkingState("responding");
    service.persistPushedBranch("cloude/sidebar-abcd");
    await waitFor(() => operations.length === 4);

    expect(operations).toEqual([
      "working:write",
      "publish",
      "branch:write",
      "publish",
    ]);
  });

  it("persists pull request state before publishing summary invalidation", async () => {
    const operations: string[] = [];
    const repository = {
      updateWorkingState: vi.fn(),
      recordAssistantTurnFinished: vi.fn(),
      markRead: vi.fn(),
      updatePushedBranch: vi.fn(),
      setPullRequest: vi.fn(),
      updatePullRequestState: vi.fn(async () => {
        operations.push("pr-state:write");
      }),
    };
    const publishSessionSummaryInvalidated = vi.fn(async () => {
      operations.push("publish");
    });
    const service = new SessionSummaryService({
      repository,
      getSessionId: () => SESSION_ID,
      getUserId: () => USER_ID,
      publishSessionSummaryInvalidated,
      logger: noopLogger,
    });

    await service.persistPullRequestState("merged");

    expect(repository.updatePullRequestState).toHaveBeenCalledWith(
      SESSION_ID,
      "merged",
    );
    expect(operations).toEqual(["pr-state:write", "publish"]);
    expect(publishSessionSummaryInvalidated).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
    );
  });

  it("publishes one invalidation after assistant-finished summary persistence", async () => {
    const operations: string[] = [];
    const repository = {
      updateWorkingState: vi.fn(),
      recordAssistantTurnFinished: vi.fn(async () => {
        operations.push("assistant-finished:write");
      }),
      markRead: vi.fn(),
      updatePushedBranch: vi.fn(),
      setPullRequest: vi.fn(),
      updatePullRequestState: vi.fn(),
    };
    const publishSessionSummaryInvalidated = vi.fn(async () => {
      operations.push("publish");
    });
    const service = new SessionSummaryService({
      repository,
      getSessionId: () => SESSION_ID,
      getUserId: () => USER_ID,
      publishSessionSummaryInvalidated,
      logger: noopLogger,
    });

    service.persistAssistantTurnFinished({
      messageId: "assistant-message-1",
      messageCreatedAt: "2026-06-03T00:00:00.000Z",
      aborted: false,
    });
    await waitFor(() => operations.length === 2);

    expect(repository.recordAssistantTurnFinished).toHaveBeenCalledWith(
      SESSION_ID,
      "assistant-message-1",
      "2026-06-03T00:00:00.000Z",
    );
    expect(operations).toEqual(["assistant-finished:write", "publish"]);
    expect(publishSessionSummaryInvalidated).toHaveBeenCalledTimes(1);
  });

  it("clears working state without recording latest assistant message for aborted turns", async () => {
    const operations: string[] = [];
    const repository = {
      updateWorkingState: vi.fn(async () => {
        operations.push("working-state:write");
      }),
      recordAssistantTurnFinished: vi.fn(),
      markRead: vi.fn(),
      updatePushedBranch: vi.fn(),
      setPullRequest: vi.fn(),
      updatePullRequestState: vi.fn(),
    };
    const publishSessionSummaryInvalidated = vi.fn(async () => {
      operations.push("publish");
    });
    const service = new SessionSummaryService({
      repository,
      getSessionId: () => SESSION_ID,
      getUserId: () => USER_ID,
      publishSessionSummaryInvalidated,
      logger: noopLogger,
    });

    service.persistAssistantTurnFinished({
      messageId: "assistant-message-1",
      messageCreatedAt: "2026-06-03T00:00:00.000Z",
      aborted: true,
    });
    await waitFor(() => operations.length === 2);

    expect(repository.updateWorkingState).toHaveBeenCalledWith(
      SESSION_ID,
      "idle",
    );
    expect(repository.recordAssistantTurnFinished).not.toHaveBeenCalled();
    expect(operations).toEqual(["working-state:write", "publish"]);
  });

  it("marks read before publishing summary invalidation", async () => {
    const operations: string[] = [];
    const repository = {
      updateWorkingState: vi.fn(),
      recordAssistantTurnFinished: vi.fn(),
      markRead: vi.fn(async () => {
        operations.push("mark-read:write");
      }),
      updatePushedBranch: vi.fn(),
      setPullRequest: vi.fn(),
      updatePullRequestState: vi.fn(),
    };
    const publishSessionSummaryInvalidated = vi.fn(async () => {
      operations.push("publish");
    });
    const service = new SessionSummaryService({
      repository,
      getSessionId: () => SESSION_ID,
      getUserId: () => USER_ID,
      publishSessionSummaryInvalidated,
      logger: noopLogger,
    });

    await service.markRead("assistant-message-1");

    expect(repository.markRead).toHaveBeenCalledWith(
      SESSION_ID,
      "assistant-message-1",
    );
    expect(operations).toEqual(["mark-read:write", "publish"]);
  });
});
