import {
  type ArchiveSessionResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  failure,
  type ListSessionsResponse,
  type PullRequestResponse,
  type PullRequestStatusResponse,
  type SessionInfoResponse as SessionInfoResponseType,
  type SessionPlanResponse as SessionPlanResponseType,
  type SessionWebSocketTokenResponse,
  type UserSessionsWebSocketTokenResponse,
  success,
  type UpdateSessionTitleResponse,
  type DeleteSessionResponse,
  type Result,
  type SessionEnvironmentSnapshot,
} from "@repo/shared";
import type { UIMessage } from "ai";
import { getAgentByName, type Agent } from "agents";
import type { SessionAgentRpc } from "@/shared/types/session-agent";
import type {
  HandleDeleteSessionResult,
  HandleGetMessagesResult,
  HandleGetPlanResult,
  HandleGetSessionResult,
  HandleInitResult,
  SessionAgentRpcError,
} from "@/shared/types/session-agent";
import { generateSessionTitle } from "@/shared/utils/generate-session-title";
import { createLogger } from "@/shared/logging";
import { SessionsRepository } from "../repositories/sessions.repository";
import {
  getPullRequestStatusForSession,
  type SessionPullRequestGitHubProvider,
  SessionPullRequestServiceError,
} from "./session-pull-request.service";
import { requestSessionAccessBlockedCleanup } from "./session-access-block.service";
import { mintSessionWebSocketToken } from "./session-websocket-token.service";
import { mintUserSessionsWebSocketToken } from "./user-sessions-websocket-token.service";
import {
  createUserSessionsPublisher,
  type UserSessionsPublisher,
} from "./user-sessions-publisher.service";
import {
  assertSessionRepoAccess,
  assertUserRepoAccess,
  type SessionRepoAccessProviders,
} from "./session-repo-access.service";
import type { Env } from "@/shared/types";
import { toSqliteDatetime } from "@/shared/utils/utils";

const logger = createLogger("sessions.service.ts");

const SESSION_CREATION_DAILY_LIMIT = 100;

type SessionMessagesResponse = UIMessage[];

type SessionsServiceStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

export interface SessionsServiceError {
  domain: "sessions";
  status: SessionsServiceStatus;
  message: string;
  code?: string;
  details?: string;
  url?: string;
}

type SessionsServiceResult<T> = Result<T, SessionsServiceError>;

export interface SessionAttachmentProvider {
  bindUnboundOwnedToSession(
    attachmentIds: string[],
    userId: string,
    sessionId: string,
  ): Promise<boolean>;
  unbindFromSession(
    attachmentIds: string[],
    userId: string,
    sessionId: string,
  ): Promise<void>;
}

export interface SessionsServiceDeps {
  env: Env;
  attachmentProvider: SessionAttachmentProvider;
  repoAccessProviders: SessionRepoAccessProviders;
  repoEnvironmentResolver: SessionRepoEnvironmentResolver;
  createPullRequestGitHubProvider(): SessionPullRequestGitHubProvider;
}

export interface SessionRepoEnvironmentResolver {
  resolveEnvironmentSnapshot(params: {
    environmentId: string | undefined;
    userId: string;
    repoId: number;
  }): Promise<Result<SessionEnvironmentSnapshot, {
    status: 400 | 403 | 404 | 409 | 503;
    message: string;
    code?: string;
  }>>;
}

export class SessionsService {
  private readonly env: Env;
  private readonly sessionsRepository: SessionsRepository;
  private readonly attachmentProvider: SessionAttachmentProvider;
  private readonly repoAccessProviders: SessionRepoAccessProviders;
  private readonly repoEnvironmentResolver: SessionRepoEnvironmentResolver;
  private readonly createPullRequestGitHubProvider: () => SessionPullRequestGitHubProvider;
  private readonly userSessionsPublisher: UserSessionsPublisher;

  constructor(deps: SessionsServiceDeps) {
    this.env = deps.env;
    this.sessionsRepository = new SessionsRepository(deps.env.DB);
    this.attachmentProvider = deps.attachmentProvider;
    this.repoAccessProviders = deps.repoAccessProviders;
    this.repoEnvironmentResolver = deps.repoEnvironmentResolver;
    this.createPullRequestGitHubProvider = deps.createPullRequestGitHubProvider;
    this.userSessionsPublisher = createUserSessionsPublisher(
      deps.env,
      logger.scope("user-sessions-publisher"),
    );
  }

  /**
   * Lists the user's non-archived sessions grouped by repo for the sidebar.
   *
   * Default mode (no `repoId`): returns a page of repo groups ordered by most
   * recent activity, each containing up to `sessionLimit` sessions and a
   * `nextSessionCursor` for loading more sessions within that repo.
   *
   * Single-repo mode (`repoId` provided): returns a single-group response
   * with sessions for that one repo, paginated via `sessionCursor`. Used by
   * the "load more in this repo" path. Returns an empty `groups` array if
   * the repo has no non-archived sessions for this user.
   *
   * @param params.userId - Authenticated user id.
   * @param params.repoId - Optional repo filter; switches to single-repo mode.
   * @param params.repoCursor - Repo-page cursor (default mode only).
   * @param params.sessionCursor - Session-page cursor for the given `repoId`.
   * @param params.repoLimit - Repos per page (default 10).
   * @param params.sessionLimit - Sessions per repo group (default 5).
   */
  async listSessions(params: {
    userId: string;
    repoId?: number;
    repoCursor?: string;
    sessionCursor?: string;
    repoLimit?: number;
    sessionLimit?: number;
  }): Promise<ListSessionsResponse> {
    if (params.repoId !== undefined) {
      const group = await this.sessionsRepository.listSessionsForRepo(
        params.userId,
        params.repoId,
        {
          sessionCursor: params.sessionCursor,
          sessionLimit: params.sessionLimit,
        },
      );
      return {
        groups: group ? [group] : [],
        nextRepoCursor: null,
      };
    }

    return this.sessionsRepository.listGroupedByUser(params.userId, {
      repoCursor: params.repoCursor,
      repoLimit: params.repoLimit,
      sessionLimit: params.sessionLimit,
    });
  }

  /**
   * Creates a session record, binds requested attachments, initializes the
   * backing Durable Object, and returns a websocket token for the caller.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @param params.request - Session creation payload.
   * @returns Created session metadata on success.
   */
  async createSession(params: {
    userId: string;
    githubAccessToken: string;
    request: CreateSessionRequest;
  }): Promise<SessionsServiceResult<CreateSessionResponse>> {
    const rateLimitResult = await this.assertSessionCreationRateLimit(params.userId);
    if (!rateLimitResult.ok) {
      return rateLimitResult;
    }

    const repoAccessResult = await assertUserRepoAccess({
      env: this.env,
      providers: this.repoAccessProviders,
      userId: params.userId,
      repoId: params.request.repoId,
      githubAccessToken: params.githubAccessToken,
    });
    if (!repoAccessResult.ok) {
      return failure(this.buildError({
        status: repoAccessResult.error.status,
        message: repoAccessResult.error.message,
        code: repoAccessResult.error.code,
      }));
    }

    const sessionId = crypto.randomUUID();
    const environmentSnapshotResult = await this.repoEnvironmentResolver.resolveEnvironmentSnapshot({
      environmentId: params.request.environmentId,
      userId: params.userId,
      repoId: repoAccessResult.value.repoId,
    });
    if (!environmentSnapshotResult.ok) {
      return failure(this.buildError({
        status: environmentSnapshotResult.error.status,
        message: environmentSnapshotResult.error.message,
        code: environmentSnapshotResult.error.code,
      }));
    }
    const environmentSnapshot = environmentSnapshotResult.value;

    logger.info("Creating session agent", {
      fields: {
        sessionId,
        userId: params.userId,
        repositoryFullName: repoAccessResult.value.repoFullName,
      },
    });

    const attachmentIds = [...new Set(params.request.initialMessage.attachmentIds ?? [])];
    const initialMessage = {
      ...params.request.initialMessage,
      attachmentIds,
    };
    let attachmentsBound = false;

    await this.sessionsRepository.create({
      id: sessionId,
      userId: params.userId,
      repoId: repoAccessResult.value.repoId,
      installationId: repoAccessResult.value.installationId,
      repoFullName: repoAccessResult.value.repoFullName,
      sourceEnvironmentId: environmentSnapshot.sourceEnvironmentId,
      sourceEnvironmentName: environmentSnapshot.sourceEnvironmentName,
    });

    try {
      if (attachmentIds.length > 0) {
        const didBindAttachments = await this.attachmentProvider.bindUnboundOwnedToSession(
          attachmentIds,
          params.userId,
          sessionId,
        );
        if (!didBindAttachments) {
          await this.sessionsRepository.delete(sessionId);
          return failure(this.buildError({
            status: 400,
            message: "Failed to bind one or more attachments. Ensure they exist, are unbound, and are owned by you.",
          }));
        }
        attachmentsBound = true;
      }

      const initResult = await this.initializeSessionAgent({
        sessionId,
        userId: params.userId,
        repoFullName: repoAccessResult.value.repoFullName,
        settings: params.request.settings,
        agentMode: params.request.agentMode,
        branch: params.request.branch,
        environmentSnapshot,
        initialMessage,
      });
      if (!initResult.ok) {
        if (attachmentsBound && attachmentIds.length > 0) {
          await this.attachmentProvider.unbindFromSession(
            attachmentIds,
            params.userId,
            sessionId,
          );
        }
        await this.sessionsRepository.delete(sessionId);
        return failure(initResult.error);
      }
    } catch (error) {
      if (attachmentsBound && attachmentIds.length > 0) {
        await this.attachmentProvider.unbindFromSession(
          attachmentIds,
          params.userId,
          sessionId,
        );
      }
      await this.sessionsRepository.delete(sessionId);

      const details = error instanceof Error
        ? error.message
        : "Unknown error";

      return failure(this.buildError({
        status: 500,
        message: "Failed to create session",
        details,
      }));
    }

    let title: string | null = null;
    if (initialMessage.content) {
      try {
        title = await generateSessionTitle(
          this.env.ANTHROPIC_API_KEY,
          initialMessage.content,
        );
        await this.sessionsRepository.updateTitle(sessionId, title);
      } catch (error) {
        logger.error("Failed to generate title at creation", { error });
      }
    }

    const webSocketToken = await mintSessionWebSocketToken(
      this.env.WEBSOCKET_TOKEN_SIGNING_KEY,
      {
        sessionId,
        userId: params.userId,
      },
    );
    await this.publishSessionSummaryCreated(params.userId, sessionId);

    return success({
      sessionId,
      title,
      websocketToken: webSocketToken.token,
      websocketTokenExpiresAt: webSocketToken.expiresAt,
    });
  }

  /**
   * Fetches session info after verifying that the caller still has access to
   * the session repository.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Session info on success.
   */
  async getSession(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<SessionInfoResponseType>> {
    const authorizedSessionAgent = await this.getAuthorizedSessionAgent(params);
    if (!authorizedSessionAgent.ok) {
      return authorizedSessionAgent;
    }

    const result = await authorizedSessionAgent.value.handleGetSession() as HandleGetSessionResult;
    if (!result.ok) {
      return failure(this.mapAgentError(result.error));
    }

    const session = await this.sessionsRepository.getById(params.sessionId);

    return success({
      ...result.value,
      title: session?.title ?? null,
    });
  }

  /**
   * Mints a websocket token for a session after validating current repo access.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Websocket token payload on success.
   */
  async createSessionWebSocketToken(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<SessionWebSocketTokenResponse>> {
    const accessResult = await assertSessionRepoAccess({
      env: this.env,
      providers: this.repoAccessProviders,
      sessionId: params.sessionId,
      userId: params.userId,
      githubAccessToken: params.githubAccessToken,
    });

    if (!accessResult.ok) {
      switch (accessResult.error.code) {
        case "REPO_ACCESS_BLOCKED":
          await requestSessionAccessBlockedCleanup(this.env, params.sessionId);
          return failure(this.buildError({
            status: 403,
            message: accessResult.error.message,
            code: accessResult.error.code,
          }));

        case "GITHUB_AUTH_REQUIRED":
          logger.error("GitHub auth required unexpectedly for websocket token route", {
            fields: { sessionId: params.sessionId, userId: params.userId },
          });
          throw new Error(
            "GitHub auth required unexpectedly for websocket token route",
          );

        case "GITHUB_API_ERROR":
          logger.warn("Temporary GitHub failure while minting session websocket token", {
            fields: {
              sessionId: params.sessionId,
              userId: params.userId,
              code: accessResult.error.code,
            },
          });
          return failure(this.buildError({
            status: 503,
            message: accessResult.error.message,
            code: accessResult.error.code,
          }));

        case "SESSION_NOT_FOUND":
        case "INVALID_REPO":
          return failure(this.buildError({
            status: 404,
            message: "Session not found",
          }));

        default: {
          const exhaustiveCheck: never = accessResult.error;
          throw new Error(`Unhandled session repo access error: ${exhaustiveCheck}`);
        }
      }
    }

    logger.log("Creating session websocket token", {
      fields: { sessionId: params.sessionId },
    });
    const webSocketToken = await mintSessionWebSocketToken(
      this.env.WEBSOCKET_TOKEN_SIGNING_KEY,
      {
        sessionId: params.sessionId,
        userId: params.userId,
      },
    );
    logger.log("Created session websocket token", {
      fields: { sessionId: params.sessionId },
    });

    return success(webSocketToken);
  }

  async createUserSessionsWebSocketToken(params: {
    userId: string;
  }): Promise<UserSessionsWebSocketTokenResponse> {
    return mintUserSessionsWebSocketToken(
      this.env.WEBSOCKET_TOKEN_SIGNING_KEY,
      {
        userId: params.userId,
      },
    );
  }

  /**
   * Updates the persisted session title for a caller-owned session.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.title - New session title.
   * @returns Updated title on success.
   */
  async updateSessionTitle(params: {
    sessionId: string;
    userId: string;
    title: string;
  }): Promise<SessionsServiceResult<UpdateSessionTitleResponse>> {
    const ownershipResult = await this.assertSessionOwnership(params.sessionId, params.userId);
    if (!ownershipResult.ok) {
      return ownershipResult;
    }

    await this.sessionsRepository.updateTitle(params.sessionId, params.title);
    await this.publishSessionSummaryInvalidated(params.userId, params.sessionId);
    return success({ title: params.title });
  }

  /**
   * Fetches persisted UI messages for a session after repo access validation.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Session messages on success.
   */
  async getSessionMessages(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<SessionMessagesResponse>> {
    const authorizedSessionAgent = await this.getAuthorizedSessionAgent(params);
    if (!authorizedSessionAgent.ok) {
      return authorizedSessionAgent;
    }

    const result = await authorizedSessionAgent.value.handleGetMessages() as HandleGetMessagesResult;
    if (!result.ok) {
      return failure(this.mapAgentError(result.error));
    }

    return success(result.value);
  }

  /**
   * Fetches the latest stored session plan after repo access validation.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Session plan on success.
   */
  async getSessionPlan(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<SessionPlanResponseType>> {
    const authorizedSessionAgent = await this.getAuthorizedSessionAgent(params);
    if (!authorizedSessionAgent.ok) {
      return authorizedSessionAgent;
    }

    const result = await authorizedSessionAgent.value.handleGetPlan() as HandleGetPlanResult;
    if (!result.ok) {
      return failure(this.mapAgentError(result.error));
    }

    return success(result.value);
  }

  /**
   * Creates a pull request for the session branch after repo access validation.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Pull request metadata on success.
   */
  async createPullRequest(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<PullRequestResponse>> {
    const authorizedSessionAgent = await this.getAuthorizedSessionAgent(params);
    if (!authorizedSessionAgent.ok) {
      return authorizedSessionAgent;
    }

    const result = await authorizedSessionAgent.value.handleCreatePullRequest();
    if (!result.ok) {
      return failure(this.mapAgentError(result.error));
    }

    return success(result.value);
  }

  /**
   * Fetches pull request status for the session after repo access validation.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Pull request status on success.
   */
  async getPullRequest(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<PullRequestStatusResponse>> {
    const authorizedSessionAgent = await this.getAuthorizedSessionAgent(params);
    if (!authorizedSessionAgent.ok) {
      return authorizedSessionAgent;
    }

    const github = this.createPullRequestGitHubProvider();
    try {
      const pullRequestStatus = await getPullRequestStatusForSession({
        sessionStub: authorizedSessionAgent.value,
        githubService: github,
      });
      return success(pullRequestStatus);
    } catch (error) {
      if (error instanceof SessionPullRequestServiceError) {
        if (error.status === 404) {
          return failure(this.buildError({
            status: 404,
            message: error.responseBody.error,
          }));
        }
        if (error.status === 400) {
          return failure(this.buildError({
            status: 400,
            message: error.responseBody.error,
          }));
        }
        return failure(this.buildError({
          status: 500,
          message: error.responseBody.error,
        }));
      }

      throw error;
    }
  }

  /**
   * Archives a caller-owned session without deleting its data.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @returns Archive marker on success.
   */
  async archiveSession(params: {
    sessionId: string;
    userId: string;
  }): Promise<SessionsServiceResult<ArchiveSessionResponse>> {
    const ownershipResult = await this.assertSessionOwnership(params.sessionId, params.userId);
    if (!ownershipResult.ok) {
      return ownershipResult;
    }

    await this.sessionsRepository.archive(params.sessionId);
    await this.publishSessionSummaryRemoved(params.userId, params.sessionId);
    return success({ archived: true });
  }

  /**
   * Deletes a session after terminating its backing Durable Object and queues
   * attachment cleanup.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Deletion marker on success.
   */
  async deleteSession(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<DeleteSessionResponse>> {
    const authorizedSessionAgent = await this.getAuthorizedSessionAgent(params);
    if (!authorizedSessionAgent.ok) {
      return authorizedSessionAgent;
    }

    const result = await authorizedSessionAgent.value.handleDeleteSession() as HandleDeleteSessionResult;
    if (!result.ok) {
      return failure(this.mapAgentError(result.error));
    }

    await this.sessionsRepository.deleteAndQueueAttachmentGc(params.sessionId);
    await this.publishSessionSummaryRemoved(params.userId, params.sessionId);
    return success({ deleted: true });
  }

  private async publishSessionSummaryInvalidated(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.userSessionsPublisher.invalidateSessionSummary({
        userId,
        sessionId,
      });
    } catch (error) {
      logger.warn("Failed to publish session summary invalidation", {
        error,
        fields: { sessionId, userId },
      });
    }
  }

  private async publishSessionSummaryCreated(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.userSessionsPublisher.createSessionSummary({
        userId,
        sessionId,
      });
    } catch (error) {
      logger.warn("Failed to publish session summary creation", {
        error,
        fields: { sessionId, userId },
      });
    }
  }

  private async publishSessionSummaryRemoved(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      await this.userSessionsPublisher.removeSessionSummary({
        userId,
        sessionId,
      });
    } catch (error) {
      logger.warn("Failed to publish session summary removal", {
        error,
        fields: { sessionId, userId },
      });
    }
  }

  private mapAgentError(error: SessionAgentRpcError): SessionsServiceError {
    switch (error.code) {
      case "SESSION_NOT_INITIALIZED":
        return this.buildError({ status: 404, message: "Session not found" });
      case "PLAN_NOT_FOUND":
        return this.buildError({ status: 404, message: "Plan not found" });
      case "PULL_REQUEST_NOT_FOUND":
        return this.buildError({ status: 404, message: "Pull request not found" });
      case "BRANCH_NOT_PUSHED":
        return this.buildError({ status: 400, message: error.message });
      case "PULL_REQUEST_ALREADY_EXISTS":
        return this.buildError({ status: 409, message: error.message, url: error.url });
      case "PULL_REQUEST_CREATE_IN_PROGRESS":
        return this.buildError({ status: 409, message: error.message });
      case "INVALID_REPO":
        return this.buildError({ status: 400, message: error.message });
      case "PULL_REQUEST_CREATE_FAILED":
        return this.buildError({ status: 400, message: error.message, details: error.details });
      case "ALREADY_INITIALIZED":
        return this.buildError({ status: 500, message: "Session already initialized" });
      case "EDITOR_DISABLED":
        return this.buildError({ status: 503, message: error.message });
      default: {
        const _exhaustiveCheck: never = error;
        throw new Error(`Unhandled DO RPC error: ${JSON.stringify(_exhaustiveCheck)}`);
      }
    }
  }

  private buildError(params: {
    status: SessionsServiceStatus;
    message: string;
    code?: string;
    details?: string;
    url?: string;
  }): SessionsServiceError {
    return {
      domain: "sessions",
      status: params.status,
      message: params.message,
      code: params.code,
      details: params.details,
      url: params.url,
    };
  }

  private async initializeSessionAgent(params: {
    sessionId: string;
    userId: string;
    repoFullName: string;
    settings: CreateSessionRequest["settings"];
    agentMode: CreateSessionRequest["agentMode"];
    branch: CreateSessionRequest["branch"];
    environmentSnapshot: SessionEnvironmentSnapshot;
    initialMessage: CreateSessionRequest["initialMessage"];
  }): Promise<SessionsServiceResult<void>> {
    const sessionAgent = await this.getSessionAgent(params.sessionId);
    const initResult = await sessionAgent.handleInit(
      {
        sessionId: params.sessionId,
        userId: params.userId,
        repoFullName: params.repoFullName,
        agentSettings: params.settings,
        agentMode: params.agentMode,
        branch: params.branch,
        environmentSnapshot: params.environmentSnapshot,
        initialMessage: params.initialMessage,
      },
    ) as HandleInitResult;

    if (!initResult.ok) {
      return failure(this.buildError({
        status: initResult.error.status,
        message: "Failed to create session",
        details: initResult.error.message,
        code: initResult.error.code,
      }));
    }
    return success(undefined);
  }

  private async getSessionAgent(sessionId: string): Promise<SessionAgentRpc> {
    return getAgentByName<Env, Agent<Env, unknown, Record<string, unknown>>>(
      this.env.SESSION_AGENT as unknown as DurableObjectNamespace<Agent<Env, unknown, Record<string, unknown>>>,
      sessionId,
    ) as unknown as Promise<SessionAgentRpc>;
  }

  private async getAuthorizedSessionAgent(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<SessionAgentRpc>> {
    const accessResult = await assertSessionRepoAccess({
      env: this.env,
      providers: this.repoAccessProviders,
      sessionId: params.sessionId,
      userId: params.userId,
      githubAccessToken: params.githubAccessToken,
    });
    if (!accessResult.ok) {
      if (accessResult.error.code === "REPO_ACCESS_BLOCKED") {
        await requestSessionAccessBlockedCleanup(this.env, params.sessionId);
        return failure(this.buildError({
          status: 403,
          message: accessResult.error.message,
          code: accessResult.error.code,
        }));
      }

      if (accessResult.error.code === "GITHUB_AUTH_REQUIRED") {
        logger.error("GitHub auth required unexpectedly for authenticated session route", {
          fields: { sessionId: params.sessionId, userId: params.userId },
        });
        throw new Error(
          "GitHub auth required unexpectedly for authenticated session route",
        );
      }

      if (accessResult.error.status === 503) {
        logger.warn("Temporary GitHub failure while authorizing session route", {
          fields: {
            sessionId: params.sessionId,
            userId: params.userId,
            code: accessResult.error.code,
          },
        });
        return failure(this.buildError({
          status: 503,
          message: accessResult.error.message,
          code: accessResult.error.code,
        }));
      }

      return failure(this.buildError({
        status: 404,
        message: "Session not found",
      }));
    }

    return success(await this.getSessionAgent(params.sessionId));
  }

  private async assertSessionCreationRateLimit(
    userId: string,
  ): Promise<SessionsServiceResult<void>> {
    const since = toSqliteDatetime(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const recentCount = await this.sessionsRepository.countRecentByUser(userId, since);

    if (recentCount >= SESSION_CREATION_DAILY_LIMIT) {
      return failure(this.buildError({
        status: 429,
        message: `Session creation limit reached. You can create up to ${SESSION_CREATION_DAILY_LIMIT} sessions per day.`,
        code: "SESSION_RATE_LIMIT_EXCEEDED",
      }));
    }

    return success(undefined);
  }

  private async assertSessionOwnership(
    sessionId: string,
    userId: string,
  ): Promise<SessionsServiceResult<void>> {
    const isOwnedByUser = await this.sessionsRepository.isOwnedByUser(sessionId, userId);
    if (!isOwnedByUser) {
      return failure(this.buildError({
        status: 404,
        message: "Session not found",
      }));
    }

    return success(undefined);
  }
}
