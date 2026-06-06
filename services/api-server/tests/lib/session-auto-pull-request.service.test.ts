import { describe, expect, it, vi } from "vitest";
import { failure, success, type Logger } from "@repo/shared";
import type { SessionRepoAccessResult } from "../../src/shared/types/repo-access";
import {
  SessionAutoPullRequestService,
  type SessionAutoPullRequestServiceDeps,
} from "../../src/runtime/session-auto-pull-request.service";

function createLogger(): Logger {
  return {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    scope() {
      return this;
    },
  };
}

function createHarness(overrides: Partial<SessionAutoPullRequestServiceDeps> = {}) {
  const state: ReturnType<SessionAutoPullRequestServiceDeps["getState"]> = {
    sessionId: "session-1",
    repoFullName: "ben/repo",
    pushedBranch: "cloude/change-abcd",
    hasPullRequest: false,
  };
  const createPullRequest = vi.fn<SessionAutoPullRequestServiceDeps["createPullRequest"]>()
    .mockResolvedValue(success({
      number: 12,
      url: "https://github.com/ben/repo/pull/12",
      state: "open",
    }));
  const keepAliveWhile = vi.fn((callback: () => Promise<void>) => callback());
  const accessResult = success({
    userId: "user-1",
    repoId: 1,
    installationId: 2,
    repoFullName: "ben/repo",
  }) as SessionRepoAccessResult;
  const service = new SessionAutoPullRequestService({
    logger: createLogger(),
    createPullRequest,
    getState: () => state,
    keepAliveWhile,
    assertSessionRepoAccess: vi.fn(async () => accessResult),
    enforceSessionAccessBlocked: vi.fn(),
    ...overrides,
  });

  return { createPullRequest, keepAliveWhile, service, state };
}

describe("SessionAutoPullRequestService", () => {
  it("creates a pull request for a pushed branch", async () => {
    const { createPullRequest, keepAliveWhile, service } = createHarness();

    service.queueCreateAfterTurnFinish();
    await keepAliveWhile.mock.results[0]!.value;

    expect(createPullRequest).toHaveBeenCalledOnce();
  });

  it("does not schedule without a pushed branch", () => {
    const { keepAliveWhile, service, state } = createHarness();
    state.pushedBranch = null;

    service.queueCreateAfterTurnFinish();

    expect(keepAliveWhile).not.toHaveBeenCalled();
  });

  it("enforces access blocking before creating a pull request", async () => {
    const enforceSessionAccessBlocked = vi.fn();
    const assertSessionRepoAccess = vi.fn(async () => failure({
      code: "REPO_ACCESS_BLOCKED",
      status: 403,
      message: "Blocked",
      justBlocked: true,
    }) as SessionRepoAccessResult);
    const { createPullRequest, keepAliveWhile, service } = createHarness({
      assertSessionRepoAccess,
      enforceSessionAccessBlocked,
    });

    service.queueCreateAfterTurnFinish();
    await keepAliveWhile.mock.results[0]!.value;

    expect(enforceSessionAccessBlocked).toHaveBeenCalledOnce();
    expect(createPullRequest).not.toHaveBeenCalled();
  });
});
