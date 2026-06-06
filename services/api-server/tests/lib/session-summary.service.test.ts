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

describe("SessionSummaryService", () => {
  it("publishes invalidation only after the D1 write resolves", async () => {
    const operations: string[] = [];
    const writeDeferred = Promise.withResolvers<void>();
    const queued: Promise<void>[] = [];
    const repository = {
      updateWorkingState: vi.fn(async () => {
        operations.push("write:start");
        await writeDeferred.promise;
        operations.push("write:done");
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
      queueBackgroundWork: (promise) => queued.push(promise),
      logger: noopLogger,
    });

    service.persistWorkingState("responding");
    await Promise.resolve();

    expect(operations).toEqual(["write:start"]);
    expect(publishSessionSummaryInvalidated).not.toHaveBeenCalled();

    writeDeferred.resolve();
    await queued[0];

    expect(operations).toEqual(["write:start", "write:done", "publish"]);
    expect(publishSessionSummaryInvalidated).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
    );
  });

  it("serializes summary mutations before publishing invalidations", async () => {
    const operations: string[] = [];
    const queued: Promise<void>[] = [];
    const repository = {
      updateWorkingState: vi.fn(async () => {
        operations.push("working:write");
      }),
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
      queueBackgroundWork: (promise) => queued.push(promise),
      logger: noopLogger,
    });

    service.persistWorkingState("responding");
    service.persistPushedBranch("cloude/sidebar-abcd");
    await Promise.all(queued);

    expect(operations).toEqual([
      "working:write",
      "publish",
      "branch:write",
      "publish",
    ]);
  });

  it("persists pull request state before publishing summary invalidation", async () => {
    const operations: string[] = [];
    const queued: Promise<void>[] = [];
    const repository = {
      updateWorkingState: vi.fn(),
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
      queueBackgroundWork: (promise) => queued.push(promise),
      logger: noopLogger,
    });

    await service.persistPullRequestState("merged");
    await Promise.all(queued);

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
});
