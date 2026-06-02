import { SpritesCoordinator } from "@/shared/integrations/sprites/sprites";
import {
  type ClientState,
  type Logger,
  ClientMessage as ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
  AgentSettings,
  DEFAULT_AGENT_SETTINGS,
  failure,
  success,
} from "@repo/shared";
import type { Env } from "@/shared/types";
import { Agent, type Connection } from "agents";
import { MessageRepository } from "@/modules/session-agent/repositories/message.repository";
import { PendingChunkRepository } from "@/modules/session-agent/repositories/pending-chunk.repository";
import { SecretRepository } from "@/modules/session-agent/repositories/secret.repository";
import { LatestPlanRepository } from "@/modules/session-agent/repositories/latest-plan.repository";
import {
  ServerStateRepository,
  type ServerState,
} from "@/modules/session-agent/repositories/server-state.repository";
import { SessionEnvironmentSnapshotRepository } from "@/modules/session-agent/repositories/session-environment-snapshot.repository";
import { migrateAll } from "@/modules/session-agent/repositories/schema-manager.repository";
import { createLogger, initializeLogger } from "@/shared/logging";
import type { UIMessageChunk } from "ai";
import type {
  HandleDeleteSessionResult,
  HandleGetMessagesResult,
  HandleGetPlanResult,
  HandleGetSessionResult,
  HandleInitResult,
  HandleUpdatePullRequestResult,
  InitSessionAgentRequest,
  SessionAgentRpc,
  SetPullRequestRequest,
  UpdatePullRequestRequest,
} from "@/shared/types/session-agent";
import { buildUserUiMessage } from "@/shared/utils/build-user-message";
import { timingSafeCompare } from "@/shared/utils/crypto";
import type { SessionRepoAccessResult } from "@/shared/types/repo-access";
import type {
  AgentEvent,
  SessionInfoResponse,
  SessionPlanResponse,
  SessionStatus,
  LogLevel,
  ChatMessageEvent,
} from "@repo/shared";
import { AgentTurnCoordinator } from "@/modules/session-agent/services/agent-turn-coordinator.service";
import { SpriteAgentProcessManager } from "@/modules/session-agent/services/sprite-agent-process-manager.service";
import { SessionProvisionService } from "@/modules/session-agent/services/session-provision.service";
import { SessionChatDispatchService } from "@/modules/session-agent/services/session-chat-dispatch.service";
import { SessionProviderConnectionService } from "@/modules/session-agent/services/session-provider-connection.service";
import { SessionGitProxyService } from "@/modules/session-agent/services/session-git-proxy.service";
import { SessionSummaryService } from "@/modules/session-agent/services/session-summary.service";
import { getProviderAuthService } from "@/modules/ai-auth/services/provider-auth.service";
import { getProviderCredentialAdapter } from "@/modules/ai-auth/services/provider-credential-adapter.service";
import { UserSessionService } from "@/modules/auth/services/user-session.service";
import { GitHubAppService } from "@/modules/github/services/github-app.service";
import { createSessionSummaryWriter } from "@/modules/sessions/services/session-access.service";
import { assertSessionRepoAccess } from "@/modules/sessions/services/session-repo-access.service";
import { SessionAgentAttachmentProvider } from "./session-agent-attachment-provider";

interface AgentStateInternalAccess {
  _setStateInternal(
    state: ClientState,
    source: Connection | "server",
  ): unknown;
}

export class SessionAgentDO extends Agent<Env, ClientState> implements SessionAgentRpc {
  private readonly logger: Logger;
  private readonly spritesCoordinator: SpritesCoordinator;
  private readonly messageRepository: MessageRepository;
  private readonly secretRepository: SecretRepository;
  private readonly latestPlanRepository: LatestPlanRepository;
  private readonly serverStateRepository: ServerStateRepository;
  private readonly environmentSnapshotRepository: SessionEnvironmentSnapshotRepository;
  private readonly pendingChunkRepository: PendingChunkRepository;
  private readonly attachmentService: SessionAgentAttachmentProvider;
  /** In-memory ServerState mirror — written through via updateServerState() */
  private serverState: ServerState;
  private readonly turnCoordinator: AgentTurnCoordinator;
  private readonly processManager: SpriteAgentProcessManager;
  private readonly provisionService: SessionProvisionService;
  private readonly chatDispatchService: SessionChatDispatchService;
  private readonly providerConnectionService: SessionProviderConnectionService;
  private readonly gitProxyService: SessionGitProxyService;
  private readonly sessionSummaryService: SessionSummaryService;

  initialState: ClientState = {
    repoFullName: null,
    status: "initializing",
    agentSettings: { ...DEFAULT_AGENT_SETTINGS },
    agentMode: "edit",
    pushedBranch: null,
    pullRequest: null,
    todos: null,
    plan: null,
    pendingUserMessage: null,
    activeTurn: null,
    editorUrl: null,
    providerConnection: null,
    lastError: null,
    baseBranch: null,
    createdAt: new Date(),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    initializeLogger({
      level: env.LOG_LEVEL as LogLevel,
      format: "pretty",
    });
    this.logger = createLogger("session-agent-do.ts");

    this.disableClientStateUpdates();

    const sql = this.sql.bind(this);
    this.messageRepository = new MessageRepository(sql);
    this.secretRepository = new SecretRepository(sql);
    this.latestPlanRepository = new LatestPlanRepository(sql);
    this.serverStateRepository = new ServerStateRepository(sql);
    this.environmentSnapshotRepository = new SessionEnvironmentSnapshotRepository(sql);
    this.pendingChunkRepository = new PendingChunkRepository(sql);
    this.spritesCoordinator = new SpritesCoordinator({
      apiKey: this.env.SPRITES_API_KEY,
    });
    this.attachmentService = new SessionAgentAttachmentProvider(this.env.DB);
    const githubAppService = new GitHubAppService(this.env, this.logger);
    this.sessionSummaryService = new SessionSummaryService({
      repository: createSessionSummaryWriter(this.env),
      getSessionId: () => this.serverState.sessionId,
      logger: this.logger,
    });

    migrateAll(sql, ctx.storage, [
      this.messageRepository,
      this.secretRepository,
      this.latestPlanRepository,
      this.serverStateRepository,
      this.environmentSnapshotRepository,
      this.pendingChunkRepository,
    ]);

    // Load server state from SQLite
    this.serverState = this.serverStateRepository.get();

    this.turnCoordinator = new AgentTurnCoordinator({
      logger: this.logger,
      env: this.env,
      messageRepository: this.messageRepository,
      pendingChunkRepository: this.pendingChunkRepository,
      latestPlanRepository: this.latestPlanRepository,
      getServerState: () => this.serverState,
      updateServerState: (partial) => this.updateServerState(partial),
      getClientState: () => this.state,
      updatePartialState: (partial) => this.updatePartialState(partial),
      broadcastMessage: (msg: ServerMessage) => this.broadcastMessage(msg),
      synthesizeStatus: () => this.synthesizeStatus(),
      terminateActiveProcess: () => this.processManager.terminateActiveProcess(),
      updateWorkingState: (state) =>
        this.sessionSummaryService.persistWorkingState(state),
    });

    this.processManager = new SpriteAgentProcessManager({
      env: this.env,
      logger: this.logger,
      secretRepository: this.secretRepository,
      getServerState: () => this.serverState,
      updateAgentProcessId: (agentProcessId) => this.updateServerState({ agentProcessId }),
      getClientState: () => this.state,
      getEnvironmentSnapshot: () => this.environmentSnapshotRepository.get(),
      getProviderCredentialAdapter,
    });

    this.provisionService = new SessionProvisionService({
      logger: this.logger,
      env: this.env,
      spritesCoordinator: this.spritesCoordinator,
      getServerState: () => this.serverState,
      getClientState: () => this.state,
      getEnvironmentSnapshot: () => this.environmentSnapshotRepository.get(),
      updateServerState: (partial) => this.updateServerState(partial),
      updatePartialState: (partial) => this.updatePartialState(partial),
      synthesizeStatus: () => this.synthesizeStatus(),
      ensureGitProxySecret: () => this.gitProxyService.ensureGitProxySecret(),
      githubTokenProvider: githubAppService,
    });

    this.chatDispatchService = new SessionChatDispatchService({
      logger: this.logger,
      env: this.env,
      messageRepository: this.messageRepository,
      attachmentService: this.attachmentService,
      turnCoordinator: this.turnCoordinator,
      processManager: this.processManager,
      getServerState: () => this.serverState,
      getClientState: () => this.state,
      updatePartialState: (partial) => this.updatePartialState(partial),
      broadcastMessage: (msg, without) => this.broadcastMessage(msg, without),
      synthesizeStatus: () => this.synthesizeStatus(),
    });

    this.providerConnectionService = new SessionProviderConnectionService({
      logger: this.logger,
      env: this.env,
      getServerState: () => this.serverState,
      getClientState: () => this.state,
      updatePartialState: (partial) => this.updatePartialState(partial),
      getProviderConnectionStatus: (provider, userId, env, logger) =>
        getProviderAuthService(provider, env, logger).getConnectionStatus(userId),
    });

    this.gitProxyService = new SessionGitProxyService({
      logger: this.logger,
      env: this.env,
      secretRepository: this.secretRepository,
      getServerState: () => this.serverState,
      getClientState: () => this.state,
      updatePartialState: (partial) => this.updatePartialState(partial),
      broadcastMessage: (msg) => this.broadcastMessage(msg),
      updatePushedBranch: (branch) =>
        this.sessionSummaryService.persistPushedBranch(branch),
      assertSessionRepoAccess: () => this.assertSessionRepoAccess(),
      enforceSessionAccessBlocked: () => this.enforceSessionAccessBlocked(),
      githubTokenProvider: githubAppService,
    });

    this.logger.info("Constructed agent DO", {
      fields: { sessionId: this.serverState.sessionId },
    });
  }

  async onStart(): Promise<void> {
    // NOTE: doing this here brecause we cant access this.name in the constructor. cf bug
    // Reset transient ClientState fields on every restart so they never get
    // stuck from a previous instance's in-progress operation.
    this.updatePartialState({
      status: this.synthesizeStatus(),
      lastError: null,
      activeTurn: this.serverState.activeUserMessageId
        ? { userMessageId: this.serverState.activeUserMessageId }
        : null,
    });
    this.logger.debug("onStart");
  }

  private disableClientStateUpdates(): void {
    // The Agents SDK allows clients to overwrite state via { type: "cf_agent_state" } WebSocket messages.
    // There is no validation hook before the write, so we intercept at _setStateInternal.
    // When source is a Connection (client), we reject the update entirely.
    const stateInternalAccess = this as unknown as AgentStateInternalAccess;
    const superSetStateInternal = stateInternalAccess._setStateInternal.bind(this);
    stateInternalAccess._setStateInternal = (
      state: ClientState,
      source: Connection | "server",
    ) => {
      if (source !== "server") {
        this.logger.warn("Rejecting client-initiated state update attempt");
        return;
      }
      return superSetStateInternal(state, source);
    };
  }

  // ============================================
  // State helpers
  // ============================================

  private updatePartialState(partial: Partial<ClientState>): void {
    this.setState({ ...this.state, ...partial });
  }

  private updateServerState(partial: Partial<ServerState>): void {
    this.serverState = { ...this.serverState, ...partial };
    this.serverStateRepository.update(partial);
  }

  /**
   * Derives the session status from durable ServerState checkpoints and
   * the in-memory agent connection state. Used to reset transient status
   * on restart and after each provisioning step.
   */
  private synthesizeStatus(): SessionStatus {
    if (!this.serverState.initialized) { return "initializing"; }
    if (!this.serverState.spriteName) { return "provisioning"; }
    if (!this.serverState.repoCloned) { return "cloning"; }
    return "ready";
  }

  /**
   * RPC entry point: refreshes the cached provider connection state.
   * Called externally via DO stub from `refreshSessionProviderConnection`.
   */
  async refreshProviderConnection(): Promise<void> {
    await this.providerConnectionService.refresh();
  }

  // ============================================
  // Webhook RPC handlers (called from /internal webhook routes)
  // ============================================

  private isWebhookTokenValid(token: string): boolean {
    const expected = this.secretRepository.get("webhook_token");
    if (!expected) {
      this.logger.warn("Webhook auth failed: no webhook token stored");
      return false;
    }
    const ok = timingSafeCompare(expected, token);
    if (!ok) { this.logger.warn("Webhook auth failed: token mismatch"); }
    return ok;
  }

  /**
   * Webhook entry point for streamed chunks. The batch is applied in order;
   * a terminal chunk in the batch finalizes the turn.
   */
  async handleWebhookChunks(
    token: string,
    userMessageId: string,
    chunks: Array<{ sequence: number; chunk: UIMessageChunk }>,
  ): Promise<boolean> {
    if (!this.isWebhookTokenValid(token)) {
      return false;
    }

    this.logger.info("handleWebhookChunks", {
      fields: {
        userMessageId,
        chunkCount: chunks.length,
        activeUserMessageId: this.serverState.activeUserMessageId,
      },
    });
    this.turnCoordinator.ensureRehydratedState();
    await this.turnCoordinator.handleChunks(userMessageId, chunks);
    return true;
  }

  /**
   * Webhook entry point for non-stream agent events. Dispatches on the
   * AgentEvent discriminator.
   */
  handleWebhookEvent(token: string, event: AgentEvent): boolean {
    if (!this.isWebhookTokenValid(token)) {
      return false;
    }

    this.logger.info("handleWebhookEvent", {
      fields: { eventType: event.type },
    });
    this.turnCoordinator.ensureRehydratedState();
    this.turnCoordinator.handleEvent(event);
    return true;
  }

  // ============================================
  // HTTP/RPC Handlers
  // ============================================

  /**
   * RPC entry point for the `/git-proxy/:sessionId/*` route. Handles repo
   * access checks, forwards the git request to GitHub, and propagates any
   * resulting token refresh or pushed-branch update into session state.
   */
  async handleGitProxy(request: Request): Promise<Response> {
    return this.gitProxyService.handleRequest(request);
  }

  // ============================================
  // WebSocket lifecycle (Agents SDK)
  // ============================================

  onConnect(connection: Connection): void {
    this.logger.debug("Client connected", {
      fields: { connectionId: connection.id },
    });
    this.turnCoordinator.ensureRehydratedState();

    // Send initial connection state
    this.sendMessage(
      {
        type: "connected",
        sessionId: this.serverState.sessionId ?? "",
        status: this.state.status,
      },
      connection,
    );

    // Send message history
    const sessionId = this.serverState.sessionId;
    if (sessionId) {
      const storedMessages = this.messageRepository.getAllBySession(sessionId);
      this.sendMessage(
        {
          type: "sync.response",
          messages: storedMessages.map((m) => m.message),
          pendingChunks: this.turnCoordinator.getPendingChunks(),
          activeTurn: this.serverState.activeUserMessageId
            ? { userMessageId: this.serverState.activeUserMessageId }
            : null,
        },
        connection,
      );
    }

    // Always call ensureReady — idempotent, skips completed steps via serverState checkpoints
    this.queueEnsureReady();
    this.providerConnectionService.queueRefresh();
  }

  async onMessage(
    connection: Connection,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const messageStr =
      typeof message === "string" ? message : new TextDecoder().decode(message);

    let messageData: unknown;
    try {
      messageData = JSON.parse(messageStr);
    } catch (error) {
      this.logger.error("Ignored non-JSON websocket message", {
        error,
        fields: {
          connectionId: connection.id,
          preview: messageStr.slice(0, 200),
        },
      });
      return;
    }

    const parsedMessage = ClientMessageSchema.safeParse(messageData);
    if (!parsedMessage.success) {
      this.logger.error("Invalid websocket message payload", {
        fields: {
          connectionId: connection.id,
          preview: messageStr.slice(0, 200),
          issues: parsedMessage.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      this.sendMessage(
        {
          type: "operation.error",
          code: "INVALID_MESSAGE",
          message: "unknown request",
        },
        connection,
      );
      return;
    }

    try {
      await this.handleClientMessage(connection, parsedMessage.data);
    } catch (error) {
      this.logger.error("Failed to handle websocket message", {
        error,
        fields: {
          connectionId: connection.id,
          type: parsedMessage.data.type,
        },
      });
      this.sendMessage(
        {
          type: "operation.error",
          code: "MESSAGE_HANDLER_ERROR",
          message: "request failed",
        },
        connection,
      );
    }
  }

  onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    this.logger.debug("WebSocket closed", {
      fields: {
        connectionId: connection.id,
        code,
        reason,
        wasClean,
      },
    });
  }

  onError(connectionOrError: Connection | unknown, error?: unknown): void {
    this.logger.error("WebSocket error", {
      error: error ?? connectionOrError,
    });
  }

  // ============================================
  // Provisioning
  // ============================================

  /**
   * Single entry point for getting the session to a ready state.
   * Called by both handleInit (HTTP) and onConnect (WebSocket).
   * Uses mutexes so concurrent callers share one in-flight operation.
   * Each step is idempotent — skipped if already completed via serverState checkpoints.
   */
  async ensureReady(): Promise<void> {
    if (!this.serverState.initialized) {
      // handleInit has not been called yet — nothing to do
      this.logger.warn("Session not initialized — skipping ensureReady");
      return;
    }
    await this.provisionService.ensureProvisioned();
    await this.chatDispatchService.maybeDispatchPendingMessage();
  }

  private queueEnsureReady(): void {
    void this.keepAliveWhile(() => this.ensureReady()).catch((error) => {
      this.logger.error("ensureReady failed", { error });
    });
  }

  // ============================================
  // Init handler
  // ============================================

  async handleInit(request: InitSessionAgentRequest): Promise<HandleInitResult> {
    // Prevent re-initialization
    if (this.serverState.initialized) {
      this.logger.error(
        "Session already initialized — refusing to re-initialize",
        {
          fields: { sessionId: this.serverState.sessionId },
        },
      );
      return failure({ code: "ALREADY_INITIALIZED", message: "Session already initialized", status: 400 });
    }

    const data = request;
    const provider = data.agentSettings?.provider ?? DEFAULT_AGENT_SETTINGS.provider;
    const maxTokens = data.agentSettings?.maxTokens ?? DEFAULT_AGENT_SETTINGS.maxTokens;

    let settings: AgentSettings;
    const parsed = AgentSettings.safeParse({
      provider,
      model: data.agentSettings?.model,
      effort: data.agentSettings?.effort,
      maxTokens,
    });
    if (parsed.success) {
      settings = parsed.data;
    } else {
      this.logger.warn("Invalid agent settings — falling back to provider defaults", {
        fields: { provider },
      });
      settings = AgentSettings.parse({ provider, maxTokens });
    }
    const providerConnection = await this.providerConnectionService.resolveState(
      settings.provider,
      data.userId,
    );

    const pendingAttachmentIds = data.initialAttachmentIds ?? [];
    const pendingUserUiMessage = await buildUserUiMessage(
      data.sessionId,
      data.initialMessage,
      pendingAttachmentIds,
      {
        attachmentService: this.attachmentService,
      },
    );
    // Mark initialized in ServerState
    this.updateServerState({
      initialized: true,
      sessionId: data.sessionId,
      userId: data.userId,
    });
    this.environmentSnapshotRepository.set(data.environmentSnapshot);

    // Store the durable initial fields in ClientState
    this.updatePartialState({
      repoFullName: data.repoFullName,
      agentSettings: settings,
      providerConnection,
      agentMode: data.agentMode ?? "edit",
      pendingUserMessage: pendingUserUiMessage
        ? {
            message: pendingUserUiMessage,
            attachmentIds: pendingAttachmentIds,
          }
        : null,
      // Store the requested base branch; cloneRepo will detect the actual branch and overwrite
      baseBranch: data.branch ?? null,
      status: this.synthesizeStatus(),
    });

    // Provision sprite asynchronously
    this.queueEnsureReady();

    return success(undefined);
  }

  // ============================================
  // Session info / management handlers
  // ============================================

  handleGetSession(): HandleGetSessionResult {
    const sessionId = this.serverState.sessionId;
    if (!sessionId || !this.state.repoFullName) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }

    return success({
      sessionId,
      title: null,
      status: this.state.status,
      repoFullName: this.state.repoFullName,
      baseBranch: this.state.baseBranch ?? undefined,
      pushedBranch: this.state.pushedBranch ?? undefined,
      pullRequestUrl: this.state.pullRequest?.url ?? undefined,
      pullRequestNumber: this.state.pullRequest?.number ?? undefined,
      pullRequestState: this.state.pullRequest?.state ?? undefined,
      editorUrl: this.state.editorUrl ?? undefined,
    } satisfies SessionInfoResponse);
  }

  handleGetMessages(): HandleGetMessagesResult {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }

    const storedMessages = this.messageRepository.getAllBySession(sessionId);
    // todo: return pending too?
    return success(storedMessages.map((m) => m.message));
  }

  handleGetPlan(): HandleGetPlanResult {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }

    const latestPlan = this.latestPlanRepository.getBySession(sessionId);
    if (!latestPlan) {
      return failure({ code: "PLAN_NOT_FOUND", message: "Plan not found" });
    }

    return success({
      plan: latestPlan.plan,
      updatedAt: latestPlan.updatedAt,
      sourceMessageId: latestPlan.sourceMessageId,
    } satisfies SessionPlanResponse);
  }

  async setPullRequest(data: SetPullRequestRequest): Promise<void> {
    this.updatePartialState({
      pullRequest: {
        url: data.url,
        number: data.number,
        state: data.state,
      },
    });
    await this.sessionSummaryService.persistPullRequest(data);
  }

  async updatePullRequest(data: UpdatePullRequestRequest): Promise<HandleUpdatePullRequestResult> {
    const pullRequest = this.state.pullRequest;
    if (!pullRequest) {
      return failure({ code: "PULL_REQUEST_NOT_FOUND", message: "Pull request not found" });
    }
    this.updatePartialState({ pullRequest: { ...pullRequest, state: data.state } });
    await this.sessionSummaryService.persistPullRequestState(data.state);
    return success(undefined);
  }

  async handleDeleteSession(): Promise<HandleDeleteSessionResult> {
    // Force-kill any running vm-agent process before we tear down the sprite.
    try {
      await this.processManager.kill();
    } catch (error) {
      this.logger.warn("Failed to kill vm-agent on session delete", { error });
    }

    // Clean up sprite
    if (this.serverState.spriteName) {
      try {
        await this.spritesCoordinator.deleteSprite(this.serverState.spriteName);
      } catch (error) {
        this.logger.error("Failed to delete sprite", { error });
      }
    }

    // Clear Agent SDK state, alarms, WebSocket resources, and all DO storage.
    await this.destroy();

    return success(undefined);
  }

  // ============================================
  // Client message handlers
  // ============================================

  private async handleClientMessage(
    connection: Connection,
    message: ClientMessage,
  ): Promise<void> {
    this.turnCoordinator.ensureRehydratedState();
    switch (message.type) {
      case "chat.message":
        await this.handleChatMessage(connection, message);
        break;
      case "sync.request":
        await this.handleSyncRequest(connection);
        break;
      case "operation.cancel":
        await this.cancelActiveTurnAndClearState();
        break;
    }
  }

  private async handleChatMessage(
    connection: Connection,
    payload: ChatMessageEvent,
  ): Promise<void> {
    try {
      if (!(await this.guardSessionRepoAccess(connection))) {
        return;
      }

      await this.ensureReady();

      if (
        this.serverState.activeUserMessageId &&
        !this.serverState.agentProcessId &&
        !this.state.pendingUserMessage
      ) {
        const staleUserMessageId = this.serverState.activeUserMessageId;
        this.logger.warn(
          "Clearing active turn with no agent process before chat dispatch",
          { fields: { userMessageId: staleUserMessageId } },
        );
        this.turnCoordinator.handleTurnSpawnFailed(
          staleUserMessageId,
          "Previous agent turn did not start",
        );
      }

      if (this.serverState.activeUserMessageId || this.state.pendingUserMessage) {
        // TODO: message queuing
        this.sendMessage(
          {
            type: "operation.error",
            code: "CHAT_MESSAGE_FAILED",
            message: "Agent is already handling a message",
          },
          connection,
        );
        return;
      }

      const result = await this.chatDispatchService.dispatchChatMessage(payload, connection.id);
      if (!result.ok) {
        this.logger.warn("Workflow chat message dispatch failed", {
          fields: { code: result.error.code },
        });
        this.sendMessage(
          {
            type: "operation.error",
            code: "CHAT_MESSAGE_FAILED",
            message: result.error.message,
          },
          connection,
        );
        return;
      }
    } catch (error) {
      this.logger.error("Failed to handle chat message", { error });
      this.sendMessage(
        {
          type: "operation.error",
          code: "CHAT_MESSAGE_FAILED",
          message: "Failed to handle chat message",
        },
        connection,
      );
    }
  }

  private async handleSyncRequest(connection: Connection): Promise<void> {
    if (!(await this.guardSessionRepoAccess(connection))) {
      return;
    }

    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      this.sendMessage(
        { type: "sync.response", messages: [], activeTurn: null },
        connection,
      );
      return;
    }

    const storedMessages = this.messageRepository.getAllBySession(sessionId);
    this.sendMessage(
      {
        type: "sync.response",
        messages: storedMessages.map((m) => m.message),
        pendingChunks: this.turnCoordinator.getPendingChunks(),
        activeTurn: this.serverState.activeUserMessageId
          ? { userMessageId: this.serverState.activeUserMessageId }
          : null,
      },
      connection,
    );
  }

  private async cancelActiveTurnAndClearState(): Promise<void> {
    const result = await this.processManager.cancelActiveTurn();
    // Treat cancel as locally authoritative: a SIGTERM may not produce a
    // terminal abort chunk, but the user must be able to send the next turn.
    this.turnCoordinator.markTurnCanceled({
      preserveAgentProcessId: result.processPreserved,
    });
  }

  private async assertSessionRepoAccess(): Promise<SessionRepoAccessResult> {
    const sessionId = this.serverState.sessionId;
    const userId = this.serverState.userId;
    if (!sessionId || !userId) {
      return {
        ok: false as const,
        error: {
          code: "SESSION_NOT_FOUND" as const,
          status: 404 as const,
          message: "Session not found",
        },
      };
    }

    const github = new GitHubAppService(
      this.env,
      createLogger("session-agent-do.repo-access"),
    );
    return assertSessionRepoAccess({
      env: this.env,
      sessionId,
      userId,
      providers: {
        github,
        userTokens: new UserSessionService({
          env: this.env,
          githubTokenRefreshProvider: github,
        }),
      },
    });
  }

  private async guardSessionRepoAccess(connection: Connection): Promise<boolean> {
    const accessResult = await this.assertSessionRepoAccess();
    if (accessResult.ok) {
      return true;
    }

    switch (accessResult.error.code) {
      case "REPO_ACCESS_BLOCKED":
        await this.enforceSessionAccessBlocked(false);
        this.sendMessage(
          {
            type: "operation.error",
            code: "REPO_ACCESS_BLOCKED",
            message: accessResult.error.message,
          },
          connection,
        );
        return false;
      case "GITHUB_AUTH_REQUIRED":
        this.sendMessage(
          {
            type: "operation.error",
            code: "GITHUB_AUTH_REQUIRED",
            message: accessResult.error.message,
          },
          connection,
        );
        return false;
      default:
        this.sendMessage(
          {
            type: "operation.error",
            code: "MESSAGE_HANDLER_ERROR",
            message: accessResult.error.message,
          },
          connection,
        );
        return false;
    }
  }

  async enforceSessionAccessBlocked(
    notifyClients = true,
  ): Promise<void> {
    const message = "Repository access for this session is blocked. Update the GitHub App installation or your GitHub access to continue.";
    this.updatePartialState({
      lastError: message,
    });
    await this.cancelActiveTurnAndClearState();
    await this.processManager.kill();
    if (notifyClients) {
      this.broadcastMessage({
        type: "operation.error",
        code: "REPO_ACCESS_BLOCKED",
        message,
      });
    }
  }

  // ============================================
  // Broadcast / send helpers
  // ============================================

  private broadcastMessage(message: ServerMessage, without?: string[]): void {
    let connectionCount = 0;
    try {
      connectionCount = Array.from(this.getConnections()).length;
    } catch {
      // getConnections may not be available in all contexts
    }
    this.logger.info("broadcastMessage", {
      fields: { type: message.type, connectionCount },
    });
    this.broadcast(JSON.stringify(message), without);
  }

  private sendMessage(message: ServerMessage, to: Connection): void {
    to.send(JSON.stringify(message));
  }
}
