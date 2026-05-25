import type {
  Logger,
  PullRequestState,
  SessionWorkingState,
} from "@repo/shared";

interface SessionSummaryRepository {
  updateWorkingState(
    sessionId: string,
    workingState: SessionWorkingState,
  ): Promise<void>;
  updatePushedBranch(sessionId: string, pushedBranch: string): Promise<void>;
  setPullRequest(
    sessionId: string,
    data: { url: string; number: number; state: PullRequestState },
  ): Promise<void>;
  updatePullRequestState(
    sessionId: string,
    state: PullRequestState,
  ): Promise<void>;
}

export class SessionSummaryPersistence {
  constructor(
    private readonly params: {
      repository: SessionSummaryRepository;
      getSessionId: () => string | null;
      logger: Logger;
    },
  ) {}

  persistWorkingState(workingState: SessionWorkingState): void {
    const sessionId = this.params.getSessionId();
    if (!sessionId) { return; }
    this.params.repository.updateWorkingState(sessionId, workingState)
      .catch((error: unknown) => {
        this.params.logger.error("Failed to persist session working state", {
          fields: { sessionId, workingState },
          error,
        });
      });
  }

  persistPushedBranch(pushedBranch: string): void {
    const sessionId = this.params.getSessionId();
    if (!sessionId) { return; }
    this.params.repository.updatePushedBranch(sessionId, pushedBranch)
      .catch((error: unknown) => {
        this.params.logger.error("Failed to persist session pushed branch", {
          fields: { sessionId },
          error,
        });
      });
  }

  async persistPullRequest(data: {
    url: string;
    number: number;
    state: PullRequestState;
  }): Promise<void> {
    const sessionId = this.params.getSessionId();
    if (!sessionId) { return; }
    await this.params.repository.setPullRequest(sessionId, data);
  }

  async persistPullRequestState(state: PullRequestState): Promise<void> {
    const sessionId = this.params.getSessionId();
    if (!sessionId) { return; }
    await this.params.repository.updatePullRequestState(sessionId, state);
  }
}
