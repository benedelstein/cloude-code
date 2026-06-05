import { describe, expect, it, vi } from "vitest";
import { failure, success, type Logger } from "@repo/shared";
import type { SessionAgentRpc } from "../../src/shared/types/session-agent";
import type { SessionRepoAccessResult } from "../../src/shared/types/repo-access";
import {
  SessionAutoPullRequestService,
  type SessionAutoPullRequestServiceDeps,
} from "../../src/runtime/session-auto-pull-request.service";
import type {
  GitHubAppResult,
  GitHubCompareData,
  PullRequestData,
} from "../../src/shared/types/github";
import type { SessionPullRequestGitHubProvider } from "../../src/modules/sessions/services/session-pull-request.service";

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
  const setPullRequestCreating = vi.fn<SessionAgentRpc["setPullRequestCreating"]>().mockResolvedValue(undefined);
  const setPullRequest = vi.fn<SessionAgentRpc["setPullRequest"]>().mockResolvedValue(undefined);
  const setPullRequestFailed = vi.fn<SessionAgentRpc["setPullRequestFailed"]>().mockResolvedValue(undefined);
  const sessionStub = {
    handleGetSession: vi.fn<SessionAgentRpc["handleGetSession"]>().mockReturnValue(success({
      sessionId: "session-1",
      title: null,
      status: "ready",
      repoFullName: "ben/repo",
      baseBranch: "main",
      pushedBranch: "cloude/change-abcd",
    })),
    handleGetMessages: vi.fn<SessionAgentRpc["handleGetMessages"]>().mockReturnValue(success([])),
    setPullRequestCreating,
    setPullRequest,
    setPullRequestFailed,
  } as unknown as SessionAgentRpc;
  const github: SessionPullRequestGitHubProvider = {
    compareBranches: vi.fn<SessionPullRequestGitHubProvider["compareBranches"]>()
      .mockResolvedValue(failure({
        code: "GITHUB_API_ERROR",
        message: "Compare failed",
      }) as GitHubAppResult<GitHubCompareData>),
    createPullRequest: vi.fn<SessionPullRequestGitHubProvider["createPullRequest"]>()
      .mockResolvedValue(success({
        number: 12,
        url: "https://github.com/ben/repo/pull/12",
        state: "open",
        merged: false,
      }) as GitHubAppResult<PullRequestData>),
    getPullRequest: vi.fn<SessionPullRequestGitHubProvider["getPullRequest"]>(),
  };
  const keepAliveWhile = vi.fn((callback: () => Promise<void>) => callback());
  const accessResult = success({
    userId: "user-1",
    repoId: 1,
    installationId: 2,
    repoFullName: "ben/repo",
  }) as SessionRepoAccessResult;
  const service = new SessionAutoPullRequestService({
    logger: createLogger(),
    sessionStub,
    github,
    anthropicApiKey: "test-key",
    getState: () => state,
    keepAliveWhile,
    assertSessionRepoAccess: vi.fn(async () => accessResult),
    enforceSessionAccessBlocked: vi.fn(),
    ...overrides,
  });

  return { github, keepAliveWhile, service, sessionStub, setPullRequest, setPullRequestCreating, state };
}

describe("SessionAutoPullRequestService", () => {
  it("creates and persists a pull request for a pushed branch", async () => {
    const { github, keepAliveWhile, service, setPullRequest, setPullRequestCreating } = createHarness();

    service.queueCreateAfterTurnFinish();
    await keepAliveWhile.mock.results[0]!.value;

    expect(github.createPullRequest).toHaveBeenCalledWith("ben/repo", {
      title: "Change",
      body: "",
      head: "cloude/change-abcd",
      base: "main",
    });
    expect(setPullRequestCreating).toHaveBeenCalledOnce();
    expect(setPullRequest).toHaveBeenCalledWith({
      number: 12,
      url: "https://github.com/ben/repo/pull/12",
      state: "open",
    });
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
    const { github, keepAliveWhile, service } = createHarness({
      assertSessionRepoAccess,
      enforceSessionAccessBlocked,
    });

    service.queueCreateAfterTurnFinish();
    await keepAliveWhile.mock.results[0]!.value;

    expect(enforceSessionAccessBlocked).toHaveBeenCalledOnce();
    expect(github.createPullRequest).not.toHaveBeenCalled();
  });
});
