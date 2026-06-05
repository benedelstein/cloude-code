import type { Logger } from "@repo/shared";
import type { SessionAgentRpc } from "@/shared/types/session-agent";
import type { SessionRepoAccessResult } from "@/shared/types/repo-access";
import {
  createPullRequestForSession,
  type SessionPullRequestGitHubProvider,
  SessionPullRequestServiceError,
} from "@/modules/sessions/services/session-pull-request.service";

interface AutoPullRequestState {
  sessionId: string | null;
  repoFullName: string | null;
  pushedBranch: string | null;
  hasPullRequest: boolean;
}

export interface SessionAutoPullRequestServiceDeps {
  logger: Logger;
  sessionStub: SessionAgentRpc;
  github: SessionPullRequestGitHubProvider;
  anthropicApiKey: string;
  getState: () => AutoPullRequestState;
  keepAliveWhile: (callback: () => Promise<void>) => Promise<void>;
  assertSessionRepoAccess: () => Promise<SessionRepoAccessResult>;
  enforceSessionAccessBlocked: () => Promise<void>;
}

export class SessionAutoPullRequestService {
  private readonly logger: Logger;
  private readonly sessionStub: SessionAgentRpc;
  private readonly github: SessionPullRequestGitHubProvider;
  private readonly anthropicApiKey: string;
  private readonly getState: () => AutoPullRequestState;
  private readonly keepAliveWhile: SessionAutoPullRequestServiceDeps["keepAliveWhile"];
  private readonly assertSessionRepoAccess: () => Promise<SessionRepoAccessResult>;
  private readonly enforceSessionAccessBlocked: () => Promise<void>;
  private autoPullRequestPromise: Promise<void> | null = null;

  constructor(deps: SessionAutoPullRequestServiceDeps) {
    this.logger = deps.logger.scope("session-auto-pull-request");
    this.sessionStub = deps.sessionStub;
    this.github = deps.github;
    this.anthropicApiKey = deps.anthropicApiKey;
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
      state.hasPullRequest
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
      state.hasPullRequest
    ) {
      return;
    }

    const accessResult = await this.assertSessionRepoAccess();
    if (!accessResult.ok) {
      await this.handleAccessFailure(accessResult, state);
      return;
    }

    try {
      const pullRequest = await createPullRequestForSession({
        sessionStub: this.sessionStub,
        github: this.github,
        anthropicApiKey: this.anthropicApiKey,
      });
      this.logger.info("Automatically created pull request", {
        fields: {
          sessionId: state.sessionId,
          repoFullName: state.repoFullName,
          pushedBranch: state.pushedBranch,
          pullRequestNumber: pullRequest.number,
        },
      });
    } catch (error) {
      if (error instanceof SessionPullRequestServiceError) {
        this.logger.warn("Automatic pull request creation was skipped", {
          fields: {
            sessionId: state.sessionId,
            repoFullName: state.repoFullName,
            pushedBranch: state.pushedBranch,
            status: error.status,
            message: error.message,
            details: error.responseBody.details ?? null,
          },
        });
        return;
      }

      throw error;
    }
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
