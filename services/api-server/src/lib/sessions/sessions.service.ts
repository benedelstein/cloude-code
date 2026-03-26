import { z } from "zod";
import {
  type ArchiveSessionResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  EditorCloseResponse,
  type EditorCloseResponse as EditorCloseResponseType,
  EditorOpenResponse,
  type EditorOpenResponse as EditorOpenResponseType,
  failure,
  type ListSessionsResponse,
  type PullRequestResponse,
  type PullRequestStatusResponse,
  SessionInfoResponse,
  type SessionInfoResponse as SessionInfoResponseType,
  SessionPlanResponse,
  type SessionPlanResponse as SessionPlanResponseType,
  type SessionWebSocketTokenResponse,
  success,
  type UpdateSessionTitleResponse,
  UIMessageSchema,
  type DeleteSessionResponse,
  type Result,
} from "@repo/shared";
import { getAgentByName } from "agents";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import { AttachmentService } from "@/lib/attachments/attachment-service";
import { generateSessionTitle } from "@/lib/generate-session-title";
import { GitHubAppService } from "@/lib/github";
import { createLogger } from "@/lib/logger";
import { SessionsRepository } from "@/repositories/sessions.repository";
import {
  createPullRequestForSession,
  getPullRequestStatusForSession,
  SessionPullRequestServiceError,
} from "@/lib/session-pull-request-service";
import { requestSessionAccessBlockedCleanup } from "@/lib/session-access-block";
import { mintSessionWebSocketToken } from "@/lib/session-websocket-token";
import {
  assertSessionRepoAccess,
  assertUserRepoAccess,
} from "@/lib/user-session/session-repo-access";
import type { Env } from "@/types";

const logger = createLogger("sessions.service.ts");
const sessionMessagesResponseSchema = z.array(UIMessageSchema);

type SessionMessagesResponse = z.infer<typeof sessionMessagesResponseSchema>;

interface SessionAgentFetcher {
  fetch(_request: Request): Promise<Response>;
}

type SessionsServiceStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503;

export interface SessionsServiceError {
  domain: "sessions";
  status: SessionsServiceStatus;
  message: string;
  code?: string;
  details?: string;
  url?: string;
}

type SessionsServiceResult<T> = Result<T, SessionsServiceError>;

class SessionInitializationError extends Error {
  readonly status: number;
  readonly details: string;
  readonly code?: string;

  constructor(status: number, details: string, code?: string) {
    super(details);
    this.name = "SessionInitializationError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export class SessionsService {
  private readonly env: Env;
  private readonly sessionsRepository: SessionsRepository;
  private readonly attachmentService: AttachmentService;

  constructor(env: Env) {
    this.env = env;
    this.sessionsRepository = new SessionsRepository(env.DB);
    this.attachmentService = new AttachmentService(env.DB);
  }

  /**
   * Lists non-archived sessions for a user.
   * @param params.userId - Authenticated user id.
   * @param params.repoId - Optional GitHub repo id filter.
   * @param params.limit - Optional page size.
   * @param params.cursor - Optional pagination cursor.
   * @returns Paginated session summaries.
   */
  async listSessions(params: {
    userId: string;
    repoId?: number;
    limit?: number;
    cursor?: string;
  }): Promise<ListSessionsResponse> {
    return this.sessionsRepository.listByUser(params.userId, {
      repoId: params.repoId,
      limit: params.limit,
      cursor: params.cursor,
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
    const repoAccessResult = await assertUserRepoAccess({
      env: this.env,
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
    logger.info("Creating session agent", {
      fields: {
        sessionId,
        userId: params.userId,
        repositoryFullName: repoAccessResult.value.repoFullName,
      },
    });

    const attachmentIds = [...new Set(params.request.attachmentIds ?? [])];
    let attachmentsBound = false;

    await this.sessionsRepository.create({
      id: sessionId,
      userId: params.userId,
      repoId: repoAccessResult.value.repoId,
      installationId: repoAccessResult.value.installationId,
      repoFullName: repoAccessResult.value.repoFullName,
    });

    try {
      if (attachmentIds.length > 0) {
        const didBindAttachments = await this.attachmentService.bindUnboundOwnedToSession(
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

      await this.initializeSessionAgent({
        sessionId,
        userId: params.userId,
        repoFullName: repoAccessResult.value.repoFullName,
        settings: params.request.settings,
        branch: params.request.branch,
        initialMessage: params.request.initialMessage,
        initialAttachmentIds: attachmentIds,
      });
    } catch (error) {
      if (attachmentsBound && attachmentIds.length > 0) {
        await this.attachmentService.unbindFromSession(
          attachmentIds,
          params.userId,
          sessionId,
        );
      }
      await this.sessionsRepository.delete(sessionId);

      const details = error instanceof SessionInitializationError
        ? error.details
        : error instanceof Error
        ? error.message
        : "Unknown error";
      const status = error instanceof SessionInitializationError && error.status === 401
        ? 401
        : 500;
      const code = error instanceof SessionInitializationError ? error.code : undefined;

      return failure(this.buildError({
        status,
        message: "Failed to create session",
        details,
        code,
      }));
    }

    let title: string | null = null;
    if (params.request.initialMessage) {
      try {
        title = await generateSessionTitle(
          this.env.ANTHROPIC_API_KEY,
          params.request.initialMessage,
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

    const response = await authorizedSessionAgent.value.fetch(new Request("http://do/"));
    if (!response.ok) {
      return failure(this.buildError({
        status: 404,
        message: "Session not found",
      }));
    }

    return success(SessionInfoResponse.parse(await response.json()));
  }

  /**
   * Mints a websocket token for a session owned by the caller.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @returns Websocket token payload on success.
   */
  async createSessionWebSocketToken(params: {
    sessionId: string;
    userId: string;
  }): Promise<SessionsServiceResult<SessionWebSocketTokenResponse>> {
    const ownershipResult = await this.assertSessionOwnership(params.sessionId, params.userId);
    if (!ownershipResult.ok) {
      return ownershipResult;
    }

    logger.log(`creating session websocket token for ${params.sessionId}`);
    const webSocketToken = await mintSessionWebSocketToken(
      this.env.WEBSOCKET_TOKEN_SIGNING_KEY,
      {
        sessionId: params.sessionId,
        userId: params.userId,
      },
    );
    logger.log(`created session websocket token for ${params.sessionId}`);

    return success(webSocketToken);
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

    const response = await authorizedSessionAgent.value.fetch(
      new Request("http://do/messages"),
    );
    if (!response.ok) {
      return failure(this.buildError({
        status: 500,
        message: "Failed to get messages",
      }));
    }

    return success(sessionMessagesResponseSchema.parse(await response.json()));
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

    const response = await authorizedSessionAgent.value.fetch(
      new Request("http://do/plan"),
    );
    if (response.status === 404) {
      return failure(this.buildError({
        status: 404,
        message: "Plan not found",
      }));
    }
    if (!response.ok) {
      return failure(this.buildError({
        status: 500,
        message: "Failed to get plan",
      }));
    }

    return success(SessionPlanResponse.parse(await response.json()));
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

    const github = new GitHubAppService(this.env, logger);
    try {
      const pullRequest = await createPullRequestForSession({
        sessionStub: authorizedSessionAgent.value,
        github,
        anthropicApiKey: this.env.ANTHROPIC_API_KEY,
      });
      return success(pullRequest);
    } catch (error) {
      if (error instanceof SessionPullRequestServiceError) {
        if (error.status === 409 && error.responseBody.url) {
          return failure(this.buildError({
            status: 409,
            message: error.responseBody.error,
            url: error.responseBody.url,
          }));
        }
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
            details: error.responseBody.details,
          }));
        }
        return failure(this.buildError({
          status: 400,
          message: "Failed to create pull request",
        }));
      }

      throw error;
    }
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

    const github = new GitHubAppService(this.env, logger);
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

    const response = await authorizedSessionAgent.value.fetch(
      new Request("http://do/", { method: "DELETE" }),
    );
    if (!response.ok) {
      return failure(this.buildError({
        status: 500,
        message: "Failed to delete session",
      }));
    }

    await this.sessionsRepository.deleteAndQueueAttachmentGc(params.sessionId);
    return success({ deleted: true });
  }

  /**
   * Opens the editor on the Sprite VM for a session after repo access
   * validation.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Editor access payload on success.
   */
  async openEditor(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<EditorOpenResponseType>> {
    const authorizedSessionAgent = await this.getAuthorizedSessionAgent(params);
    if (!authorizedSessionAgent.ok) {
      return authorizedSessionAgent;
    }

    const response = await authorizedSessionAgent.value.fetch(
      new Request("http://do/editor/open", { method: "POST" }),
    );
    if (!response.ok) {
      const details = await response.text();
      return failure(this.buildError({
        status: response.status === 400 ? 400 : 500,
        message: "Failed to open editor",
        details,
      }));
    }

    return success(EditorOpenResponse.parse(await response.json()));
  }

  /**
   * Closes the editor on the Sprite VM for a session after repo access
   * validation.
   * @param params.sessionId - Session id.
   * @param params.userId - Authenticated user id.
   * @param params.githubAccessToken - Current GitHub user access token.
   * @returns Editor close marker on success.
   */
  async closeEditor(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<EditorCloseResponseType>> {
    const authorizedSessionAgent = await this.getAuthorizedSessionAgent(params);
    if (!authorizedSessionAgent.ok) {
      return authorizedSessionAgent;
    }

    const response = await authorizedSessionAgent.value.fetch(
      new Request("http://do/editor/close", { method: "POST" }),
    );
    if (!response.ok) {
      const details = await response.text();
      return failure(this.buildError({
        status: response.status === 400 ? 400 : 500,
        message: "Failed to close editor",
        details,
      }));
    }

    return success(EditorCloseResponse.parse(await response.json()));
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
    branch: CreateSessionRequest["branch"];
    initialMessage: CreateSessionRequest["initialMessage"];
    initialAttachmentIds: string[];
  }): Promise<void> {
    const sessionAgent = await this.getSessionAgent(params.sessionId);
    const initResponse = await sessionAgent.fetch(
      new Request("http://do/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: params.sessionId,
          userId: params.userId,
          repoFullName: params.repoFullName,
          settings: params.settings,
          branch: params.branch,
          initialMessage: params.initialMessage,
          initialAttachmentIds: params.initialAttachmentIds,
        }),
      }),
    );

    if (!initResponse.ok) {
      const responseText = await initResponse.text();
      let responseBody: { error?: string; code?: string } | null;
      try {
        responseBody = JSON.parse(responseText) as { error?: string; code?: string };
      } catch {
        responseBody = null;
      }

      throw new SessionInitializationError(
        initResponse.status,
        responseBody?.error ?? (responseText || "Failed to initialize session"),
        responseBody?.code,
      );
    }
  }

  private async getSessionAgent(sessionId: string): Promise<SessionAgentFetcher> {
    return getAgentByName<Env, SessionAgentDO>(this.env.SESSION_AGENT, sessionId);
  }

  private async getAuthorizedSessionAgent(params: {
    sessionId: string;
    userId: string;
    githubAccessToken: string;
  }): Promise<SessionsServiceResult<SessionAgentFetcher>> {
    const accessResult = await assertSessionRepoAccess({
      env: this.env,
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
