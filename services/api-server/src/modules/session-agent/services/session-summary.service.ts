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

export class SessionSummaryService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly params: {
      repository: SessionSummaryRepository;
      getSessionId: () => string | null;
      getUserId: () => string | null;
      publishSessionSummaryInvalidated: (
        userId: string,
        sessionId: string,
      ) => Promise<void>;
      queueBackgroundWork: (promise: Promise<void>) => void;
      logger: Logger;
    },
  ) {}

  persistWorkingState(workingState: SessionWorkingState): void {
    void this.enqueueMutation(
      "working_state",
      (sessionId) =>
        this.params.repository.updateWorkingState(sessionId, workingState),
      { workingState },
    );
  }

  persistPushedBranch(pushedBranch: string): void {
    void this.enqueueMutation(
      "pushed_branch",
      (sessionId) =>
        this.params.repository.updatePushedBranch(sessionId, pushedBranch),
      {},
    );
  }

  async persistPullRequest(data: {
    url: string;
    number: number;
    state: PullRequestState;
  }): Promise<void> {
    await this.enqueueMutation(
      "pull_request",
      (sessionId) => this.params.repository.setPullRequest(sessionId, data),
      {},
    );
  }

  async persistPullRequestState(state: PullRequestState): Promise<void> {
    await this.enqueueMutation(
      "pull_request_state",
      (sessionId) =>
        this.params.repository.updatePullRequestState(sessionId, state),
      { state },
    );
  }

  private enqueueMutation(
    operation: string,
    mutation: (sessionId: string) => Promise<void>,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = this.params.getSessionId();
    const userId = this.params.getUserId();
    if (!sessionId || !userId) {
      return Promise.resolve();
    }

    const rawTask = this.mutationQueue.then(async () => {
      await mutation(sessionId);
      try {
        await this.params.publishSessionSummaryInvalidated(userId, sessionId);
      } catch (error) {
        this.params.logger.warn("Failed to publish session summary invalidation", {
          fields: { sessionId, userId },
          error,
        });
      }
    });

    const observedTask = rawTask.catch((error: unknown) => {
      this.params.logger.error("Failed to persist session summary mutation", {
        fields: { sessionId, userId, operation, ...fields },
        error,
      });
    });
    this.mutationQueue = observedTask;
    this.params.queueBackgroundWork(observedTask);
    return rawTask;
  }
}
