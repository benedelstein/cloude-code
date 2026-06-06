import type { ClientState, Logger } from "@repo/shared";
import type { HandleCreatePullRequestResult } from "@/shared/types/session-agent";
import type { SessionRepoAccessResult } from "@/shared/types/repo-access";

type AutoPullRequestStatus = NonNullable<ClientState["pullRequest"]>["status"] | null;

interface AutoPullRequestState {
  sessionId: string | null;
  repoFullName: string | null;
  pushedBranch: string | null;
  pullRequestStatus: AutoPullRequestStatus;
}

export interface SessionAutoPullRequestServiceDeps {
  logger: Logger;
  createPullRequest: () => Promise<HandleCreatePullRequestResult>;
  getState: () => AutoPullRequestState;
  keepAliveWhile: (callback: () => Promise<void>) => Promise<void>;
  assertSessionRepoAccess: () => Promise<SessionRepoAccessResult>;
  enforceSessionAccessBlocked: () => Promise<void>;
}

export class SessionAutoPullRequestService {
  private readonly logger: Logger;
  private readonly createPullRequest: () => Promise<HandleCreatePullRequestResult>;
  private readonly getState: () => AutoPullRequestState;
  private readonly keepAliveWhile: SessionAutoPullRequestServiceDeps["keepAliveWhile"];
  private readonly assertSessionRepoAccess: () => Promise<SessionRepoAccessResult>;
  private readonly enforceSessionAccessBlocked: () => Promise<void>;
  private autoPullRequestPromise: Promise<void> | null = null;

  constructor(deps: SessionAutoPullRequestServiceDeps) {
    this.logger = deps.logger.scope("session-auto-pull-request");
    this.createPullRequest = deps.createPullRequest;
    this.getState = deps.getState;
    this.keepAliveWhile = deps.keepAliveWhile;
    this.assertSessionRepoAccess = deps.assertSessionRepoAccess;
    this.enforceSessionAccessBlocked = deps.enforceSessionAccessBlocked;
  }

  queueCreateAfterTurnFinish(): void {
    const state = this.getState();
    if (
      this.autoPullRequestPromise ||
      !state.sessionId ||
      !state.repoFullName ||
      !state.pushedBranch ||
      isAutoPullRequestBlocked(state.pullRequestStatus)
    ) {
      return;
    }

    this.autoPullRequestPromise = this.keepAliveWhile(
      () => this.createAfterTurnFinish(),
    )
      .catch((error) => {
        this.logger.error("Automatic pull request creation failed", {
          error,
          fields: {
            sessionId: state.sessionId,
            repoFullName: state.repoFullName,
            pushedBranch: state.pushedBranch,
          },
        });
      })
      .finally(() => {
        this.autoPullRequestPromise = null;
      });
  }

  private async createAfterTurnFinish(): Promise<void> {
    const state = this.getState();
    if (
      !state.sessionId ||
      !state.repoFullName ||
      !state.pushedBranch ||
      isAutoPullRequestBlocked(state.pullRequestStatus)
    ) {
      return;
    }

    const accessResult = await this.assertSessionRepoAccess();
    if (!accessResult.ok) {
      await this.handleAccessFailure(accessResult, state);
      return;
    }

    const pullRequestResult = await this.createPullRequest();
    if (!pullRequestResult.ok) {
      this.logger.warn("Automatic pull request creation was skipped", {
        fields: {
          sessionId: state.sessionId,
          repoFullName: state.repoFullName,
          pushedBranch: state.pushedBranch,
          code: pullRequestResult.error.code,
          message: pullRequestResult.error.message,
          details: "details" in pullRequestResult.error
            ? pullRequestResult.error.details ?? null
            : null,
        },
      });
      return;
    }

    this.logger.info("Automatically created pull request", {
      fields: {
        sessionId: state.sessionId,
        repoFullName: state.repoFullName,
        pushedBranch: state.pushedBranch,
        pullRequestNumber: pullRequestResult.value.number,
      },
    });
  }

  private async handleAccessFailure(
    accessResult: Extract<SessionRepoAccessResult, { ok: false }>,
    state: AutoPullRequestState,
  ): Promise<void> {
    switch (accessResult.error.code) {
      case "REPO_ACCESS_BLOCKED":
        await this.enforceSessionAccessBlocked();
        return;
      case "GITHUB_AUTH_REQUIRED":
      case "GITHUB_API_ERROR":
      case "SESSION_NOT_FOUND":
      case "INVALID_REPO":
        this.logger.warn("Skipping automatic pull request creation after access check failure", {
          fields: {
            sessionId: state.sessionId,
            repoFullName: state.repoFullName,
            pushedBranch: state.pushedBranch,
            code: accessResult.error.code,
          },
        });
        return;
    }
  }
}

function isAutoPullRequestBlocked(
  pullRequestStatus: AutoPullRequestState["pullRequestStatus"],
): boolean {
  return pullRequestStatus === "creating" || pullRequestStatus === "created";
}
