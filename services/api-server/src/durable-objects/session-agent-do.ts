import { SpritesCoordinator, WorkersSpriteClient } from "@/lib/sprites";
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
  getProviderModelDefinition,
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
import { buildNetworkPolicy } from "@/lib/sprites/network-policy";
import { handleGitProxy, type GitProxyContext } from "@/lib/git-proxy";
import { configureGitRemote } from "@/lib/git-setup";
import { ensureValidInstallationToken } from "./session-agent-github-token";
import { createLogger, initializeLogger } from "@/lib/logger";
import { GitHubAppService } from "@/lib/github/github-app";
import type { UIMessage, UIMessageChunk } from "ai";
// DISABLED: editor feature imports — security issue (sprite URL set to public)
// import {
//   handleEditorOpen,
//   handleEditorClose,
// } from "./session-agent-editor";
import { updateSessionHistoryData } from "./session-agent-history";
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
import {
  createUserUiMessage,
  getUserMessageTextContent,
} from "@/lib/utils/uimessage-utils";
import { AttachmentRecord } from "@/types/attachments";
import { buildUserUiMessage } from "@/lib/create-user-message";
import {
  assertSessionRepoAccess,
  type SessionRepoAccessResult,
} from "@/lib/user-session/session-repo-access";
import { getProviderAuthService } from "@/lib/providers/provider-auth-service";
import type {
  AgentProcessRunnerTurnResult,
  PreparedWorkflowTurn,
} from "@/workflows/AgentProcessRunner";
import type {
  PrepareWorkflowTurnOverrides,
  WorkflowTurnFailure,
  WorkflowTurnPayload,
} from "@/workflows/types";
import { AgentWorkflowCoordinator } from "./lib/AgentWorkflowCoordinator";

const WORKSPACE_DIR = "/home/sprite/workspace";

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
  /** In-memory ServerState mirror — written through via updateServerState() */
  private serverState: ServerState;
  /** Mutex for durable provisioning steps (sprite creation, repo clone) */
  private ensureProvisionedPromise: Promise<void> | null = null;
  /** GitHub App installation access token (in-memory cache, persisted in SQLite) */
  private githubToken: string | null = null;
  /** Random nonce for git proxy auth (in-memory cache, persisted in SQLite secrets) */
  private gitProxySecret: string | null = null;
  /** Connection token for the VS Code editor (in-memory cache, persisted in SQLite secrets) */
  // private editorToken: string | null = null;
  private readonly workflowTurnCoordinator: AgentWorkflowCoordinator;

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

    migrateAll([
      this.messageRepository,
      this.secretRepository,
      this.latestPlanRepository,
      this.serverStateRepository,
      this.pendingChunkRepository,
    ]);

    // Load secrets from SQLite into memory
    this.githubToken = this.secretRepository.get("github_token");
    this.gitProxySecret = this.secretRepository.get("git_proxy_secret");
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
      restartWorkflow: this.restartWorkflow.bind(this),
    });

    // Rebuild in-memory accumulator + derived state from the WAL.
    this.workflowTurnCoordinator.rehydratePendingMessageState();

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

  private async resolveProviderConnectionState(
    providerId: ClientState["agentSettings"]["provider"],
    userId: string | null,
  ): Promise<ClientState["providerConnection"]> {
    if (!userId) {
      return {
        provider: providerId,
        connected: false,
        requiresReauth: false,
      };
    }

    try {
      const service = getProviderAuthService(providerId, this.env, this.logger);
      const status = await service.getConnectionStatus(userId);
      return {
        provider: providerId,
        connected: status.connected,
        requiresReauth: status.requiresReauth,
      };
    } catch (error) {
      this.logger.error("Failed to resolve provider connection state", {
        error,
        fields: { provider: providerId, userId },
      });
      return null;
    }
  }

  private queueRefreshProviderConnection(): void {
    this.ctx.waitUntil(
      this.refreshProviderConnection().catch((error) => {
        this.logger.error("Failed to refresh provider connection state", { error });
      }),
    );
  }

  /**
   * Refreshes the active session provider connection state from the provider auth service.
   * @returns Resolves when the cached provider connection state has been updated, if available.
   */
  async refreshProviderConnection(): Promise<void> {
    const providerConnection = await this.resolveProviderConnectionState(
      this.state.agentSettings.provider,
      this.serverState.userId,
    );
    if (providerConnection) {
      this.updatePartialState({ providerConnection });
    }
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
    messageId: string,
    result: AgentProcessRunnerTurnResult,
  ): void {
    this.workflowTurnCoordinator.handleTurnFinished(messageId, result);
  }

  onWorkflowTurnFailed(
    messageId: string,
    error: WorkflowTurnFailure,
  ): void {
    this.workflowTurnCoordinator.handleTurnFailed(messageId, error);
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
    const path = url.pathname;

    // Git proxy: forward git operations to GitHub with auth
    if (path.startsWith("/git-proxy/")) {
      const accessResult = await this.assertSessionRepoAccess(); // ensure user still has access to the repo.
      if (!accessResult.ok) {
        switch (accessResult.error.code) {
          case "REPO_ACCESS_BLOCKED":
            await this.enforceSessionAccessBlocked();
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: accessResult.error.status,
                headers: { "Content-Type": "application/json" },
              },
            );
          case "GITHUB_AUTH_REQUIRED":
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: 401,
                headers: { "Content-Type": "application/json" },
              },
            );
          case "GITHUB_API_ERROR":
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: 503,
                headers: { "Content-Type": "application/json" },
              },
            );
          case "SESSION_NOT_FOUND":
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: 404,
                headers: { "Content-Type": "application/json" },
              },
            );
          case "INVALID_REPO":
            return new Response(
              JSON.stringify({
                error: accessResult.error.message,
                code: accessResult.error.code,
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          default: {
            const exhaustiveCheck: never = accessResult.error;
            throw new Error(`Unhandled session repo access error: ${JSON.stringify(exhaustiveCheck)}`);
          }
        }
      }

      const result = await handleGitProxy(
        request,
        path,
        this.gitProxyContext(),
      );
      if (result.githubToken) {
        this.githubToken = result.githubToken;
      }
      // Capture pushed branch name and notify clients
      if (result.pushedBranch && result.response.ok) {
        if (result.pushedBranch !== this.state.pushedBranch) {
          this.updatePartialState({ pushedBranch: result.pushedBranch });
          this.broadcastMessage({
            type: "branch.pushed",
            branch: result.pushedBranch,
            repoFullName: this.state.repoFullName ?? "",
          });
        }
      }
      return result.response;
    }

    // Pass unhandled requests to Agent SDK (WebSocket upgrades, internal setup routes, etc.)
    return super.fetch(request);
  }

  // ============================================
  // WebSocket lifecycle (Agents SDK)
  // ============================================

  onConnect(connection: Connection): void {
    this.logger.debug(`client connected: ${connection.id}`);

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
    this.queueRefreshProviderConnection();
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
    await this.ensureProvisioned();
    await this.maybeDispatchPendingMessage();
  }

  private queueEnsureReady(): void {
    this.ctx.waitUntil(
      this.ensureReady().catch((error) => {
        this.logger.error("ensureReady failed", { error });
      }),
    );
  }

  private ensureProvisioned(): Promise<void> {
    if (this.ensureProvisionedPromise) return this.ensureProvisionedPromise;
    this.ensureProvisionedPromise = this._provision().finally(() => {
      this.ensureProvisionedPromise = null;
    });
    return this.ensureProvisionedPromise;
  }

  private async _provision(): Promise<void> {
    try {
      if (!this.serverState.spriteName) {
        this.updatePartialState({ status: this.synthesizeStatus() });
        this.logger.debug(
          `Provisioning sprite for session ${this.serverState.sessionId}`,
        );

        const spriteResponse = await this.spritesCoordinator.createSprite({
          name: this.serverState.sessionId!,
        });

        // Lock down outbound network access to known-good domains
        const sprite = new WorkersSpriteClient(
          spriteResponse.name,
          this.env.SPRITES_API_KEY,
          this.env.SPRITES_API_URL,
        );
        const workerHostname = new URL(this.env.WORKER_URL).hostname;
        const networkPolicy = buildNetworkPolicy([
          { domain: workerHostname, action: "allow" },
        ]);
        await sprite.setNetworkPolicy(networkPolicy);

        this.updateServerState({ spriteName: spriteResponse.name });
        this.updatePartialState({ status: this.synthesizeStatus() });
      }

      if (!this.serverState.repoCloned) {
        this.updatePartialState({ status: this.synthesizeStatus() });
        await this.cloneRepo(this.serverState.spriteName!);
        this.updateServerState({ repoCloned: true });
        this.updatePartialState({
          status: this.synthesizeStatus(),
          lastError: null,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to provision session", { error });
      this.updatePartialState({
        lastError: errorMessage,
        status: this.synthesizeStatus(),
      });
      throw error;
    }
  }

  /**
   * Clones the repository onto the sprite and configures git remotes.
   * Assumes the sprite is already created and the network policy is set.
   */
  private async cloneRepo(spriteName: string): Promise<void> {
    const repoFullName = this.state.repoFullName!;
    const sessionId = this.serverState.sessionId!;

    const sprite = new WorkersSpriteClient(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    const proxyBaseUrl = `${this.env.WORKER_URL}/git-proxy/${sessionId}`;
    const cloneUrl = `${proxyBaseUrl}/github.com/${repoFullName}.git`;
    const githubRemoteUrl = `https://github.com/${repoFullName}.git`;

    // Check if the repo is already cloned (sprite may be persistent)
    const isCloned = await sprite.execHttp(
      `test -d ${WORKSPACE_DIR}/.git && echo 'exists' || echo 'empty'`,
      {},
    );
    if (isCloned.stdout.includes("exists")) {
      this.logger.info(
        `Repo ${repoFullName} already cloned on sprite ${spriteName}`,
      );
    } else {
      this.logger.info(`Cloning repo ${repoFullName} on sprite ${spriteName}`);
      await sprite.execHttp(`mkdir -p ${WORKSPACE_DIR}`, {});

      // Fetch a read-only token scoped to contents:read for the initial clone
      const github = new GitHubAppService(this.env, this.logger);
      const cloneTokenResult = await github.getReadOnlyTokenForRepo(repoFullName);
      if (!cloneTokenResult.ok) {
        throw new Error(cloneTokenResult.error.message);
      }
      const cloneToken = cloneTokenResult.value;
      const basicAuth = btoa(`x-access-token:${cloneToken}`);

      // Also refresh the write token for the proxy (used after clone)
      await this.refreshGitHubToken();
      const cloneStart = Date.now();
      const baseBranch = this.state.baseBranch;
      const branchFlag = baseBranch ? `--branch ${baseBranch} ` : "";
      const cloneResult = await sprite.execHttp(
        `git -c http.extraHeader="Authorization: Basic ${basicAuth}" clone --single-branch ${branchFlag}${githubRemoteUrl} ${WORKSPACE_DIR}`,
        {},
      );
      this.logger.info(
        `Clone completed in ${((Date.now() - cloneStart) / 1000).toFixed(1)}s: exitCode=${cloneResult.exitCode}, stderr=${cloneResult.stderr.slice(0, 500)}`,
      );
      if (cloneResult.exitCode !== 0) {
        throw new Error(
          `Clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr}`,
        );
      }
    }

    // Detect the base branch (whatever branch the clone checked out)
    const branchResult = await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git rev-parse --abbrev-ref HEAD`,
      {},
    );
    const actualBaseBranch = branchResult.stdout.trim() || "main";
    if (actualBaseBranch !== this.state.baseBranch && this.state.baseBranch) {
      this.logger.warn(
        `Base branch ${this.state.baseBranch} does not match actual base branch ${actualBaseBranch}`,
      );
    }
    this.updatePartialState({ baseBranch: actualBaseBranch });

    if (!this.gitProxySecret) {
      this.gitProxySecret = crypto.randomUUID();
      this.secretRepository.set("git_proxy_secret", this.gitProxySecret);
    }

    // Configure remote URLs, git identity, and proxy auth header
    await configureGitRemote(sprite, {
      workspaceDir: WORKSPACE_DIR,
      githubRemoteUrl,
      cloneUrl,
      proxyBaseUrl,
      gitProxySecret: this.gitProxySecret,
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
    const providerConnection = await this.resolveProviderConnectionState(
      settings.provider,
      data.userId,
    );

    // Generate git proxy secret and persist
    if (!this.gitProxySecret) {
      this.gitProxySecret = crypto.randomUUID();
      this.secretRepository.set("git_proxy_secret", this.gitProxySecret);
    } else {
      // should never happen
      this.logger.warn(
        "Git proxy secret already exists, skipping generation(?)",
      );
    }

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

      const result = await this.dispatchChatMessageToWorkflow(payload, connection.id);
      if (!result.ok) {
        this.logger.warn("Workflow chat message dispatch failed", {
          fields: { code: result.error.code ?? "unknown" },
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

  // ============================================
  // Attachment helpers
  // ============================================

  /**
   * Dispatches the pending initial message through the session workflow once provisioning completes.
   */
  private async maybeDispatchPendingMessage(): Promise<void> {
    const pendingMessage = this.state.pendingUserMessage;
    if (!pendingMessage || this.serverState.workflowState.activeUserMessageId) {
      return;
    }
    this.state.pendingUserMessage = null;
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return;
    }

    const { message: userMessage, attachmentIds } = pendingMessage;
    const content = getUserMessageTextContent(userMessage);
    // TODO: WHAT IF ATTACHMENT RESOLUTION FAILS?
    const attachmentRecords = await this.getBoundAttachmentRecords(
      sessionId,
      attachmentIds,
    );

    try {
      await this.onUserMessageSent(userMessage, attachmentRecords);
      await this.dispatchTurnToWorkflow({
        userMessage: {
          id: userMessage.id,
          content,
          attachmentIds,
        },
      });
      this.updatePartialState({ pendingUserMessage: null });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to dispatch pending workflow message", { error });
      this.updatePartialState({
        lastError: errorMessage,
        status: this.synthesizeStatus(),
      });
      this.broadcastMessage({
        type: "operation.error",
        code: "CHAT_MESSAGE_FAILED",
        message: "Failed to handle chat message",
      });
    }
  }

  private async dispatchChatMessageToWorkflow(
    payload: ChatMessageEvent,
    connectionId: string,
  ): Promise<Result<void, WorkflowTurnFailure>> {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return failure({
        code: "SESSION_NOT_INITIALIZED",
        message: "Session is not initialized",
      });
    }

    const attachmentIds =
      payload.attachments?.map((attachment) => attachment.attachmentId) ?? [];
    const attachmentRecords = await this.getBoundAttachmentRecords(
      sessionId,
      attachmentIds,
    );
    if (attachmentRecords.length !== attachmentIds.length) {
      return failure({
        code: "ATTACHMENTS_NOT_FOUND",
        message: "Some attachments were not found for this session",
      });
    }

    const content = payload.content?.trim();

    let modelOverride: string | undefined;
    if (payload.model && payload.model !== this.state.agentSettings.model) {
      const modelResult = this.validateAndApplyModelSwitch(payload.model);
      if (!modelResult.ok) {
        return failure(modelResult.error);
      }
      modelOverride = modelResult.value;
    }

    let agentModeOverride: AgentMode | undefined;
    if (payload.agentMode && payload.agentMode !== this.state.agentMode) {
      this.updatePartialState({ agentMode: payload.agentMode });
      agentModeOverride = payload.agentMode;
    }

    const userUiMessage = createUserUiMessage(
      content,
      attachmentRecords,
      payload.messageId,
    );
    if (!userUiMessage) {
      return failure({
        code: "INVALID_MESSAGE",
        message: "Message must include content or attachments",
      });
    }

    // save before dispatching to workflow to avoid race conditions
    await this.onUserMessageSent(userUiMessage, attachmentRecords, connectionId);
    try {
      this.logger.debug(`dispatching message with id: ${userUiMessage.id}`);
      await this.dispatchTurnToWorkflow({
        userMessage: {
          id: userUiMessage.id,
          content,
          attachmentIds,
        },
        model: modelOverride,
        agentMode: agentModeOverride,
      });
    } catch (error) {
      return failure({
        code: "WORKFLOW_DISPATCH_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return success(undefined);
  }

  private validateAndApplyModelSwitch(
    model: string,
  ): Result<string, WorkflowTurnFailure> {
    const validatedModel = getProviderModelDefinition(
      this.state.agentSettings.provider,
      model,
    );
    if (!validatedModel) {
      this.logger.warn("Invalid provider model in workflow model switch", {
        fields: { provider: this.state.agentSettings.provider, model },
      });
      return failure({
        code: "INVALID_MODEL",
        message: "Invalid model for the current provider",
        provider: this.state.agentSettings.provider,
        model,
      });
    }

    this.updatePartialState({
      agentSettings: {
        ...this.state.agentSettings,
        model: validatedModel.id,
      } as AgentSettings,
    });
    return success(validatedModel.id);
  }

  private async getBoundAttachmentRecords(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]> {
    if (attachmentIds.length === 0) {
      return [];
    }

    const attachmentService = new AttachmentService(this.env.DB);
    return attachmentService.getByIdsBoundToSession(sessionId, attachmentIds);
  }

  private async dispatchTurnToWorkflow(
    turnPayload: WorkflowTurnPayload,
  ): Promise<void> {
    await this.workflowTurnCoordinator.dispatchTurn(turnPayload);
  }

  private async cancelActiveWorkflowTurn(): Promise<void> {
    await this.workflowTurnCoordinator.cancelActiveTurn();
  }

  private async stopWorkflowManagedProcesses(): Promise<void> {
    await this.workflowTurnCoordinator.stopManagedProcesses();
  }

  // handle side effects of sending a user message
  private async onUserMessageSent(
    message: UIMessage,
    attachmentRecords: AttachmentRecord[],
    connectionId?: string,
  ): Promise<void> {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) return;
    const existing = this.messageRepository.getById(message.id);
    if (existing) {
      return;
    }
    const stored = this.messageRepository.create(sessionId, message);
    this.broadcastMessage(
      { type: "user.message", message: stored.message },
      connectionId ? [connectionId] : undefined,
    );
    // Sync to D1 history row and generate title
    const content = getUserMessageTextContent(message);
    const historyContent = this.toHistorySyncContent(
      content,
      attachmentRecords,
    );
    this.ctx.waitUntil(
      updateSessionHistoryData({
        database: this.env.DB,
        anthropicApiKey: this.env.ANTHROPIC_API_KEY,
        logger: this.logger,
        sessionId,
        messageContent: historyContent,
        messageRepository: this.messageRepository,
      }),
    );
  }

  private toHistorySyncContent(
    content: string | undefined,
    attachments: AttachmentRecord[],
  ): string {
    if (content) {
      return content;
    }
    if (attachments.length === 1) {
      return `Uploaded image: ${attachments[0]!.filename}`;
    }
    return `Uploaded ${attachments.length} images`;
  }

  // ============================================
  // GitHub token helpers
  // ============================================

  private gitProxyContext(): GitProxyContext {
    return {
      gitProxySecret: this.gitProxySecret,
      repoFullName: this.state.repoFullName,
      sessionId: this.serverState.sessionId,
      githubToken: this.githubToken,
      pushedBranch: this.state.pushedBranch,
      env: this.env,
      secretRepository: this.secretRepository,
    };
  }

  private async refreshGitHubToken(): Promise<void> {
    const token = await ensureValidInstallationToken(this.gitProxyContext());
    if (token) {
      this.githubToken = token;
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
