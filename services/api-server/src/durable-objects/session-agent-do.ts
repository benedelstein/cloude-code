import { SpritesCoordinator } from "@/lib/sprites";
import {
  type ClientState,
  type AgentMode,
  type AgentSettingsInput,
  type Logger,
  ClientMessage as ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
  SessionInfoResponse,
  SessionPlanResponse,
  SessionStatus,
  LogLevel,
  ChatMessageEvent,
  AgentSettings,
  failure,
  success,
  Result,
} from "@repo/shared";
import type { Env } from "@/types";
import { Agent, type Connection } from "agents";
import { MessageRepository } from "./repositories/message-repository";
import { PendingChunkRepository } from "./repositories/pending-chunk-repository";
import { SecretRepository } from "./repositories/secret-repository";
import { LatestPlanRepository } from "./repositories/latest-plan-repository";
import {
  ServerStateRepository,
  type ServerState,
} from "./repositories/server-state-repository";
import { migrateAll } from "./repositories/schema-manager";
import { AttachmentService } from "@/lib/attachments/attachment-service";
import { ensureValidInstallationToken } from "./session-agent-github-token";
import { createLogger, initializeLogger } from "@/lib/logger";
import type { UIMessageChunk } from "ai";
// DISABLED: editor feature imports — security issue (sprite URL set to public)
// import {
//   handleEditorOpen,
//   handleEditorClose,
// } from "./session-agent-editor";
import type {
  HandleCloseEditorResult,
  HandleDeleteSessionResult,
  HandleGetMessagesResult,
  HandleGetPlanResult,
  HandleGetSessionResult,
  HandleInitResult,
  HandleOpenEditorResult,
  HandleUpdatePullRequestResult,
  SetPullRequestRequest,
  UpdatePullRequestRequest,
} from "@/types/session-agent";
import { buildUserUiMessage } from "@/lib/create-user-message";
import {
  assertSessionRepoAccess,
  type SessionRepoAccessResult,
} from "@/lib/user-session/session-repo-access";
import type {
  AgentProcessRunnerTurnResult,
  PreparedWorkflowTurn,
} from "@/workflows/AgentProcessRunner";
import type {
  PrepareWorkflowTurnOverrides,
  WorkflowTurnFailure,
} from "@/workflows/types";
import { AgentWorkflowCoordinator } from "./lib/AgentWorkflowCoordinator";
import { SessionProvisionService } from "./lib/SessionProvisionService";
import { SessionChatDispatchService } from "./lib/SessionChatDispatchService";
import { SessionProviderConnectionService } from "./lib/SessionProviderConnectionService";
import { SessionGitProxyService } from "./lib/SessionGitProxyService";

interface InitRequest {
  sessionId: string;
  userId: string;
  repoFullName: string;
  agentSettings?: AgentSettingsInput;
  agentMode?: AgentMode;
  /** Base branch */
  branch?: string;
  initialMessage?: string;
  initialAttachmentIds?: string[];
}

export class SessionAgentDO extends Agent<Env, ClientState> {
  private readonly logger: Logger;
  private readonly spritesCoordinator: SpritesCoordinator;
  private readonly messageRepository: MessageRepository;
  private readonly secretRepository: SecretRepository;
  private readonly latestPlanRepository: LatestPlanRepository;
  private readonly serverStateRepository: ServerStateRepository;
  private readonly pendingChunkRepository: PendingChunkRepository;
  private readonly attachmentService: AttachmentService;
  /** In-memory ServerState mirror — written through via updateServerState() */
  private serverState: ServerState;
  /** GitHub App installation access token (in-memory cache, persisted in SQLite) */
  private githubInstallationToken: string | null = null;
  /** Connection token for the VS Code editor (in-memory cache, persisted in SQLite secrets) */
  // private editorToken: string | null = null;
  private readonly workflowTurnCoordinator: AgentWorkflowCoordinator;
  private readonly provisionService: SessionProvisionService;
  private readonly chatDispatchService: SessionChatDispatchService;
  private readonly providerConnectionService: SessionProviderConnectionService;
  private readonly gitProxyService: SessionGitProxyService;

  initialState: ClientState = {
    repoFullName: null,
    status: "initializing",
    agentSettings: { provider: "claude-code", model: "opus", maxTokens: 8192 },
    agentMode: "edit",
    pushedBranch: null,
    pullRequest: null,
    todos: null,
    plan: null,
    pendingUserMessage: null,
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
    this.pendingChunkRepository = new PendingChunkRepository(sql);
    this.spritesCoordinator = new SpritesCoordinator({
      apiKey: this.env.SPRITES_API_KEY,
    });
    this.attachmentService = new AttachmentService(this.env.DB);

    migrateAll([
      this.messageRepository,
      this.secretRepository,
      this.latestPlanRepository,
      this.serverStateRepository,
      this.pendingChunkRepository,
    ]);

    // Load secrets from SQLite into memory
    this.githubInstallationToken = this.secretRepository.get("github_token");
    // this.editorToken = this.secretRepository.get("editor_token");

    // Load server state from SQLite
    this.serverState = this.serverStateRepository.get();

    // Wire up the workflow turn coordinator
    this.workflowTurnCoordinator = new AgentWorkflowCoordinator({
      logger: this.logger,
      env: this.env,
      messageRepository: this.messageRepository,
      pendingChunkRepository: this.pendingChunkRepository,
      latestPlanRepository: this.latestPlanRepository,
      getServerState: () => this.serverState,
      updateWorkflowState: (partial: Partial<ServerState["workflowState"]>) => this.updateServerState({ workflowState: { ...this.serverState.workflowState, ...partial } }),
      updateAgentSessionId: (agentSessionId: string) => this.updateServerState({agentSessionId}),
      getClientState: () => this.state,
      updatePartialState: (partial: Partial<ClientState>) => this.updatePartialState(partial),
      broadcastMessage: (msg: ServerMessage) => this.broadcastMessage(msg),
      synthesizeStatus: () => this.synthesizeStatus(),
      getWorkflowStatus: this.getWorkflowStatus.bind(this),
      runWorkflow: this.runWorkflow.bind(this),
      getWorkflow: this.getWorkflow.bind(this),
      sendWorkflowEvent: this.sendWorkflowEvent.bind(this),
    });

    this.provisionService = new SessionProvisionService({
      logger: this.logger,
      env: this.env,
      spritesCoordinator: this.spritesCoordinator,
      getServerState: () => this.serverState,
      getClientState: () => this.state,
      updateServerState: (partial) => this.updateServerState(partial),
      updatePartialState: (partial) => this.updatePartialState(partial),
      synthesizeStatus: () => this.synthesizeStatus(),
      refreshGitHubToken: () => this.refreshGitHubToken(),
      ensureGitProxySecret: () => this.gitProxyService.ensureGitProxySecret(),
    });

    this.chatDispatchService = new SessionChatDispatchService({
      logger: this.logger,
      env: this.env,
      messageRepository: this.messageRepository,
      attachmentService: this.attachmentService,
      workflowCoordinator: this.workflowTurnCoordinator,
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
    });

    this.gitProxyService = new SessionGitProxyService({
      logger: this.logger,
      env: this.env,
      secretRepository: this.secretRepository,
      getServerState: () => this.serverState,
      getClientState: () => this.state,
      updatePartialState: (partial) => this.updatePartialState(partial),
      broadcastMessage: (msg) => this.broadcastMessage(msg),
      getGitHubInstallationToken: () => this.githubInstallationToken,
      setGitHubInstallationToken: (token) => {
        this.githubInstallationToken = token;
      },
      assertSessionRepoAccess: () => this.assertSessionRepoAccess(),
      enforceSessionAccessBlocked: () => this.enforceSessionAccessBlocked(),
    });

    this.logger.info(`constructed agent DO for session ${this.serverState.sessionId}`);
  }

  async onStart(): Promise<void> {
    // NOTE: doing this here brecause we cant access this.name in the constructor. cf bug
    // Reset transient ClientState fields on every restart so they never get
    // stuck from a previous instance's in-progress operation.
    this.updatePartialState({
      status: this.synthesizeStatus(),
      lastError: null,
    });
    this.logger.debug("onStart");
  }

  private disableClientStateUpdates(): void {
    // The Agents SDK allows clients to overwrite state via { type: "cf_agent_state" } WebSocket messages.
    // There is no validation hook before the write, so we intercept at _setStateInternal.
    // When source is a Connection (client), we reject the update entirely.
    const superSetStateInternal = (this as any)._setStateInternal.bind(this);
    (this as any)._setStateInternal = (
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
    if (!this.serverState.initialized) return "initializing";
    if (!this.serverState.spriteName) return "provisioning";
    if (!this.serverState.repoCloned) return "cloning";
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
  // Workflow RPC delegators
  // ============================================

  /**
   * Prepares a workflow turn for execution. The workflow should call this
   * via RPC in order to prepare the state for a new conversation turn.
   * @param userMessageId Durable user message identifier for the turn.
   * @param overrides Optional per-turn model or mode overrides.
   * @returns turn metadata needed by the workflow runner.
   */
  prepareWorkflowTurn(
    userMessageId: string,
    overrides: PrepareWorkflowTurnOverrides,
  ): Result<PreparedWorkflowTurn, WorkflowTurnFailure> {
    return this.workflowTurnCoordinator.prepareTurn(userMessageId, overrides);
  }

  /**
   * Called when the agent process starts on the VM
   * @param messageId Durable user message identifier for the turn.
   * @param agentProcessId Sprite process ID captured when the process starts.
   */
  onWorkflowTurnStarted(
    messageId: string,
    agentProcessId: number | null,
  ): boolean {
    return this.workflowTurnCoordinator.handleTurnStarted(messageId, agentProcessId);
  }

  /**
   * Called when the agent workflow emits its provider session id.
   * Used for persisting and resuming sessions across restarts.
   * @param messageId Durable user message identifier for the turn.
   * @param agentSessionId Provider conversation session id.
   */
  onWorkflowAgentSessionId(messageId: string, agentSessionId: string): void {
    this.workflowTurnCoordinator.handleAgentSessionId(messageId, agentSessionId);
  }

  onWorkflowChunk(
    messageId: string,
    sequence: number,
    chunk: UIMessageChunk,
  ): void {
    this.workflowTurnCoordinator.handleChunk(messageId, sequence, chunk);
  }

  onWorkflowTurnFinished(
    userMessageId: string,
    result: AgentProcessRunnerTurnResult,
  ): void {
    this.workflowTurnCoordinator.handleTurnFinished(userMessageId, result);
  }

  onWorkflowTurnFailed(
    userMessageId: string,
    error: WorkflowTurnFailure,
  ): void {
    if (error.code === "PROVIDER_AUTH_REQUIRED") {
      this.updatePartialState({
        providerConnection: {
          provider: this.state.agentSettings.provider,
          connected: false,
          requiresReauth: true,
        },
      });
    }
    this.workflowTurnCoordinator.handleTurnFailed(userMessageId, error);
  }

  async onWorkflowComplete(
    workflowName: string,
    workflowId: string,
    result: unknown,
  ): Promise<void> {
    await this.workflowTurnCoordinator.handleWorkflowComplete(workflowName, workflowId, result);
  }

  async onWorkflowError(
    workflowName: string,
    workflowId: string,
    error: string,
  ): Promise<void> {
    await this.workflowTurnCoordinator.handleWorkflowError(workflowName, workflowId, error);
  }

  // ============================================
  // HTTP Handlers
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.logger.debug(`[HTTP request] ${request.method} ${url.pathname}`);
    // Pass all requests to Agent SDK (WebSocket upgrades, internal setup routes, etc.)
    return super.fetch(request);
  }

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
    this.logger.debug(`client connected: ${connection.id}`);
    this.workflowTurnCoordinator.ensureRehydratedState();

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
          pendingChunks: this.workflowTurnCoordinator.getPendingChunks(),
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
    this.ensureReady().catch((error) => {
      this.logger.error("ensureReady failed", { error });
    });
  }

  // ============================================
  // Init handler
  // ============================================

  async handleInit(request: InitRequest): Promise<HandleInitResult> {
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

    const provider = data.agentSettings?.provider ?? "claude-code";
    const maxTokens = data.agentSettings?.maxTokens ?? 8192;

    let settings: AgentSettings;
    const parsed = AgentSettings.safeParse({
      provider,
      model: data.agentSettings?.model,
      maxTokens,
    });
    if (parsed.success) {
      settings = parsed.data;
    } else {
      // Invalid model — fall back to the provider's default by omitting model
      settings = AgentSettings.parse({ provider, maxTokens });
    }
    const providerConnection = await this.providerConnectionService.resolveState(
      settings.provider,
      data.userId,
    );

    // Generate git proxy secret and persist
    this.gitProxyService.ensureGitProxySecret();

    const pendingAttachmentIds = data.initialAttachmentIds ?? [];
    const pendingUserUiMessage = await buildUserUiMessage(
      data.sessionId,
      data.initialMessage,
      pendingAttachmentIds,
      {
        attachmentService: new AttachmentService(this.env.DB),
      },
    );
    // Mark initialized in ServerState
    this.updateServerState({
      initialized: true,
      sessionId: data.sessionId,
      userId: data.userId,
    });

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

  // DISABLED: security issue (sprite URL set to public)
  openEditor(): HandleOpenEditorResult {
    return failure({ code: "EDITOR_DISABLED", message: "Editor feature is temporarily disabled" });
  }

  // DISABLED: security issue (sprite URL set to public)
  closeEditor(): HandleCloseEditorResult {
    return failure({ code: "EDITOR_DISABLED", message: "Editor feature is temporarily disabled" });
  }

  setPullRequest(data: SetPullRequestRequest): void {
    this.updatePartialState({
      pullRequest: {
        url: data.url,
        number: data.number,
        state: data.state,
      },
    });
  }

  updatePullRequest(data: UpdatePullRequestRequest): HandleUpdatePullRequestResult {
    const pullRequest = this.state.pullRequest;
    if (!pullRequest) {
      return failure({ code: "PULL_REQUEST_NOT_FOUND", message: "Pull request not found" });
    }
    this.updatePartialState({ pullRequest: { ...pullRequest, state: data.state } });
    return success(undefined);
  }

  async handleDeleteSession(): Promise<HandleDeleteSessionResult> {
    // TODO: CLOSE EDITOR

    // Clean up sprite
    if (this.serverState.spriteName) {
      try {
        await this.spritesCoordinator.deleteSprite(this.serverState.spriteName);
      } catch (error) {
        this.logger.error("Failed to delete sprite", { error });
      }
    }

    // Clear all storage on the DO (DO will cease to exist after this)
    await this.ctx.storage.deleteAll();

    return success(undefined);
  }

  // ============================================
  // Client message handlers
  // ============================================

  private async handleClientMessage(
    connection: Connection,
    message: ClientMessage,
  ): Promise<void> {
    this.workflowTurnCoordinator.ensureRehydratedState();
    switch (message.type) {
      case "chat.message":
        await this.handleChatMessage(connection, message);
        break;
      case "sync.request":
        await this.handleSyncRequest(connection);
        break;
      case "operation.cancel":
        await this.cancelActiveWorkflowTurn();
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

      if (this.serverState.workflowState.activeUserMessageId || this.state.pendingUserMessage) {
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
      this.sendMessage({ type: "sync.response", messages: [] }, connection);
      return;
    }

    const storedMessages = this.messageRepository.getAllBySession(sessionId);
    this.sendMessage(
      {
        type: "sync.response",
        messages: storedMessages.map((m) => m.message),
        pendingChunks: this.workflowTurnCoordinator.getPendingChunks(),
      },
      connection,
    );
  }

  private async cancelActiveWorkflowTurn(): Promise<void> {
    await this.workflowTurnCoordinator.cancelActiveTurn();
  }

  private async stopWorkflowManagedProcesses(): Promise<void> {
    await this.workflowTurnCoordinator.stopManagedProcesses();
  }

  // ============================================
  // GitHub token helpers
  // ============================================

  private async refreshGitHubToken(): Promise<void> {
    const token = await ensureValidInstallationToken({
      repoFullName: this.state.repoFullName,
      githubInstallationToken: this.githubInstallationToken,
      env: this.env,
      secretRepository: this.secretRepository,
    });
    if (token) {
      this.githubInstallationToken = token;
    }
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

    return assertSessionRepoAccess({
      env: this.env,
      sessionId,
      userId,
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
    this.updatePartialState({
      lastError: "Repository access for this session is currently blocked.",
    });
    await this.cancelActiveWorkflowTurn();
    await this.stopWorkflowManagedProcesses();
    if (notifyClients) {
      this.broadcastMessage({
        type: "operation.error",
        code: "REPO_ACCESS_BLOCKED",
        message: "Repository access for this session is currently blocked.",
      });
    }
  }

  // ============================================
  // Broadcast / send helpers
  // ============================================

  private broadcastMessage(message: ServerMessage, without?: string[]): void {
    this.broadcast(JSON.stringify(message), without);
  }

  private sendMessage(message: ServerMessage, to: Connection): void {
    to.send(JSON.stringify(message));
  }
}
