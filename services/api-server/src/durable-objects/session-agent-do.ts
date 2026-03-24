import { SpritesCoordinator, WorkersSpriteClient } from "@/lib/sprites";
import {
  type ClientState,
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
  AgentOutput,
  AgentSettings,
} from "@repo/shared";
import type { Env } from "@/types";
import { Agent, type Connection } from "agents";
import { MessageRepository } from "./repositories/message-repository";
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
import { ensureValidInstallationToken } from "@/durable-objects/session-agent-github-token";
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
  SetPullRequestRequest,
  UpdatePullRequestRequest,
} from "@/types/session-agent";
import { AgentProcessManager } from "./lib/agent-process-manager";
import {
  createUserUiMessage,
  getUserMessageTextContent,
} from "@/lib/utils/uimessage-utils";
import { MessageAccumulator } from "@/lib/message-accumulator";
import { applyDerivedStateFromParts } from "./session-agent-derived-state";
import { AttachmentRecord } from "@/types/attachments";
import { buildUserUiMessage } from "@/lib/create-user-message";
import {
  assertSessionRepoAccess,
  REPO_ACCESS_REVOKED_CODE,
} from "@/lib/user-session/session-repo-access";

const WORKSPACE_DIR = "/home/sprite/workspace";

interface InitRequest {
  sessionId: string;
  userId: string;
  repoFullName: string;
  agentSettings?: AgentSettingsInput;
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
  private readonly agentProcessManager: AgentProcessManager;
  /** In-memory ServerState mirror — written through via updateServerState() */
  private serverState: ServerState;
  /** Mutex for durable provisioning steps (sprite creation, repo clone) */
  private ensureProvisionedPromise: Promise<void> | null = null;
  /** Mutex for ephemeral agent connection (runs fresh every DO instance) */
  private ensureAgentStartedPromise: Promise<void> | null = null;
  /** GitHub App installation access token (in-memory cache, persisted in SQLite) */
  private githubToken: string | null = null;
  /** Random nonce for git proxy auth (in-memory cache, persisted in SQLite secrets) */
  private gitProxySecret: string | null = null;
  /** Connection token for the VS Code editor (in-memory cache, persisted in SQLite secrets) */
  private editorToken: string | null = null;
  private messageAccumulator: MessageAccumulator = new MessageAccumulator();
  private sessionAccessRevoked = false;

  initialState: ClientState = {
    repoFullName: null,
    status: "initializing",
    agentSettings: { provider: "claude-code", model: "opus", maxTokens: 8192 },
    pushedBranch: null,
    pullRequest: null,
    todos: null,
    plan: null,
    pendingUserMessage: null,
    editorUrl: null,
    claudeAuthRequired: null,
    isResponding: false,
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

    const sql = this.sql.bind(this);
    this.messageRepository = new MessageRepository(sql);
    this.secretRepository = new SecretRepository(sql);
    this.latestPlanRepository = new LatestPlanRepository(sql);
    this.serverStateRepository = new ServerStateRepository(sql);
    this.spritesCoordinator = new SpritesCoordinator({
      apiKey: this.env.SPRITES_API_KEY,
    });

    migrateAll([
      this.messageRepository,
      this.secretRepository,
      this.latestPlanRepository,
      this.serverStateRepository,
    ]);

    // Load secrets from SQLite into memory
    this.githubToken = this.secretRepository.get("github_token");
    this.gitProxySecret = this.secretRepository.get("git_proxy_secret");
    this.editorToken = this.secretRepository.get("editor_token");

    // Load server state from SQLite
    this.serverState = this.serverStateRepository.get();

    this.agentProcessManager = new AgentProcessManager({
      logger: this.logger,
      env,
      getClientState: () => this.state,
      getServerState: () => this.serverState,
      onAgentOutput: (output) => this.handleAgentOutput(output),
      onAgentError: (error) => this.handleAgentError(error),
      onAgentExit: (code) => this.handleAgentExit(code),
      updateLastKnownAgentProcessId: (processId) =>
        this.updateServerState({ lastKnownAgentProcessId: processId }),
      updateClaudeAuthRequired: (claudeAuthRequired) =>
        this.updatePartialState({ claudeAuthRequired }),
      updateAgentSettings: (settings) =>
        this.updatePartialState({ agentSettings: settings }),
      updateIsResponding: (isResponding) =>
        this.updatePartialState({ isResponding }),
    });

    // Reset transient ClientState fields on every restart so they never get
    // stuck from a previous instance's in-progress operation.
    this.updatePartialState({
      status: this.synthesizeStatus(),
      lastError: null,
      claudeAuthRequired: null,
      isResponding: false,
    });
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
    if (!this.agentProcessManager.isConnected()) return "attaching";
    return "ready";
  }

  // ============================================
  // Agent lifecycle
  // ============================================

  private handleAgentOutput(output: AgentOutput): void {
    switch (output.type) {
      case "ready": {
        this.updatePartialState({ status: this.synthesizeStatus() });
        break;
      }
      case "error": {
        this.logger.error(`vm-agent error: ${output.error}`);
        this.messageAccumulator.reset();
        this.updatePartialState({
          isResponding: false,
          lastError: output.error,
          status: this.synthesizeStatus(),
        });
        break;
      }
      case "debug": {
        this.logger.debug(`[vm-agent debug] ${output.message}`);
        break;
      }
      case "stream": {
        this.broadcastMessage({
          type: "agent.chunk",
          chunk: output.chunk,
        });

        // Accumulate chunks into UIMessage and extract derived state (todos, plan)
        const { finishedMessage, completedParts } =
          this.messageAccumulator.process(output.chunk as UIMessageChunk);
        applyDerivedStateFromParts(
          {
            sessionId: this.serverState.sessionId!,
            latestPlanRepository: this.latestPlanRepository,
            updatePartialState: (partial) => this.updatePartialState(partial),
          },
          completedParts,
          this.messageAccumulator.getMessageId(),
        );

        if (finishedMessage) {
          const sessionId = this.serverState.sessionId!;
          const stored = this.messageRepository.create(
            sessionId,
            finishedMessage,
          );
          this.broadcastMessage({
            type: "agent.finish",
            message: stored.message,
          });

          // Reset in-progress message state for the next response
          this.messageAccumulator.reset();
          this.updatePartialState({ isResponding: false });
        }
        break;
      }
      case "sessionId": {
        // Persist the agent provider's session ID so it can be resumed on reconnect
        this.logger.info(`Storing agent session ID: ${output.sessionId}`);
        this.updateServerState({ agentSessionId: output.sessionId });
        break;
      }
    }
  }
  private handleAgentError(error: string): void {
    this.logger.error("Agent error", { error });
  }

  private handleAgentExit(code: number): void {
    this.logger.info(`Agent exited with code ${code}`);
    this.messageAccumulator.reset();
    this.updatePartialState({ isResponding: false });
    // TODO: RESTART THE AGENT?
  }

  // ============================================
  // HTTP Handlers
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.logger.debug(`[HTTP request] ${request.method} ${url.pathname}`);
    const path = url.pathname;

    // TODO: BETTER MIDDLEWARE
    // Root path = session operations (the DO *is* the session)
    if (path === "/" || path === "") {
      switch (request.method) {
        case "POST":
          return this.handleInit(request);
        case "GET":
          return this.handleGetSession();
        case "DELETE":
          return this.handleDeleteSession();
        default:
          return new Response("Method not allowed", { status: 405 });
      }
    }

    // Git proxy: forward git operations to GitHub with auth
    if (path.startsWith("/git-proxy/")) {
      const accessResult = await this.assertSessionRepoAccess();
      if (!accessResult.ok) {
        if (accessResult.error.code === REPO_ACCESS_REVOKED_CODE) {
          await this.enforceSessionRevoked();
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
        }

        if (accessResult.error.code === "GITHUB_AUTH_REQUIRED") {
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
        }

        return new Response(
          JSON.stringify({ error: accessResult.error.message }),
          {
            status: accessResult.error.status,
            headers: { "Content-Type": "application/json" },
          },
        );
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

    // Pull request state
    if (path === "/pr") {
      if (request.method === "POST") {
        return this.handleSetPullRequest(request);
      }
      if (request.method === "PATCH") {
        return this.handleUpdatePullRequest(request);
      }
    }

    if (path === "/revoke" && request.method === "POST") {
      await this.enforceSessionRevoked();
      return new Response(null, { status: 204 });
    }

    // Notify the session that the user has completed Claude OAuth
    if (path === "/claude-auth/refresh" && request.method === "POST") {
      await this.agentProcessManager.refreshClaudeAuth();
      return new Response(null, { status: 204 });
    }

    // Sub-resources
    if (path === "/messages" && request.method === "GET") {
      return this.handleGetMessages();
    }
    if (path === "/plan" && request.method === "GET") {
      return this.handleGetPlan();
    }

    // Editor (VS Code) lifecycle — DISABLED: security issue (sprite URL set to public)
    if (
      (path === "/editor/open" || path === "/editor/close") &&
      request.method === "POST"
    ) {
      return new Response("editor feature temporarily disabled", {
        status: 503,
      });
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
          pendingChunks: this.messageAccumulator.getPendingChunks(),
        },
        connection,
      );
    }

    // Always call ensureReady — idempotent, skips completed steps via serverState checkpoints
    this.queueEnsureReady();
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
    await this.ensureAgentStarted();
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

  private ensureAgentStarted(): Promise<void> {
    if (this.ensureAgentStartedPromise) return this.ensureAgentStartedPromise;
    this.ensureAgentStartedPromise = this._startAgent().finally(() => {
      this.ensureAgentStartedPromise = null;
    });
    return this.ensureAgentStartedPromise;
  }

  private async _startAgent(): Promise<void> {
    if (!this.serverState.spriteName || !this.serverState.repoCloned) {
      throw new Error("Cannot start agent: session not fully provisioned");
    }
    if (this.agentProcessManager.isConnected()) return;

    this.updatePartialState({ status: this.synthesizeStatus() });
    try {
      // Refresh GitHub installation token (may have expired during hibernation)
      try {
        await this.refreshGitHubToken();
      } catch (error) {
        this.logger.error("Failed to refresh GitHub token during agent start", {
          error,
        });
      }

      await this.agentProcessManager.ensureAgentSessionStarted();
      this.updatePartialState({
        status: this.synthesizeStatus(),
        lastError: null,
      });

      // Send the pending initial message if one was stored
      await this.maybeSendPendingMessage();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to start agent", { error });
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

  private async handleInit(request: Request): Promise<Response> {
    // Prevent re-initialization
    if (this.serverState.initialized) {
      this.logger.error(
        "Session already initialized — refusing to re-initialize",
        {
          fields: { sessionId: this.serverState.sessionId },
        },
      );
      return new Response(
        JSON.stringify({ error: "Session already initialized" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const data = (await request.json()) as InitRequest;

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
      pendingUserMessage: pendingUserUiMessage
        ? {
            message: pendingUserUiMessage,
            attachmentIds: pendingAttachmentIds,
          }
        : null,
      claudeAuthRequired: null,
      // Store the requested base branch; cloneRepo will detect the actual branch and overwrite
      baseBranch: data.branch ?? null,
      status: this.synthesizeStatus(),
    });

    // Provision sprite asynchronously
    this.queueEnsureReady();

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ============================================
  // Session info / management handlers
  // ============================================

  private handleGetSession(): Response {
    const sessionId = this.serverState.sessionId;
    if (!sessionId || !this.state.repoFullName) {
      return new Response("Session not found", { status: 404 });
    }

    return new Response(
      JSON.stringify({
        sessionId,
        status: this.state.status,
        repoFullName: this.state.repoFullName,
        baseBranch: this.state.baseBranch ?? undefined,
        pushedBranch: this.state.pushedBranch ?? undefined,
        pullRequestUrl: this.state.pullRequest?.url ?? undefined,
        pullRequestNumber: this.state.pullRequest?.number ?? undefined,
        pullRequestState: this.state.pullRequest?.state ?? undefined,
        editorUrl: this.state.editorUrl ?? undefined,
      } satisfies SessionInfoResponse),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  private handleGetMessages(): Response {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const storedMessages = this.messageRepository.getAllBySession(sessionId);
    return new Response(JSON.stringify(storedMessages.map((m) => m.message)), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleGetPlan(): Response {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const latestPlan = this.latestPlanRepository.getBySession(sessionId);
    if (!latestPlan) {
      return new Response(JSON.stringify({ error: "Plan not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        plan: latestPlan.plan,
        updatedAt: latestPlan.updatedAt,
        sourceMessageId: latestPlan.sourceMessageId,
      } satisfies SessionPlanResponse),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  private async handleSetPullRequest(request: Request): Promise<Response> {
    const data: SetPullRequestRequest = await request.json();
    this.updatePartialState({
      pullRequest: {
        url: data.url,
        number: data.number,
        state: data.state,
      },
    });
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleUpdatePullRequest(request: Request): Promise<Response> {
    const data: UpdatePullRequestRequest = await request.json();
    const pullRequest = this.state.pullRequest;
    if (!pullRequest) {
      return new Response(JSON.stringify({ error: "Pull request not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const newState = { ...pullRequest, state: data.state };
    this.updatePartialState({ pullRequest: newState });
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleDeleteSession(): Promise<Response> {
    // Editor close skipped — editor feature is disabled

    // Clean up sprite
    if (this.serverState.spriteName) {
      try {
        await this.spritesCoordinator.deleteSprite(this.serverState.spriteName);
      } catch (error) {
        this.logger.error("Failed to delete sprite", { error });
      }
    }

    // Clear all storage on the DO (DO will cease to exist after this)
    this.ctx.storage.deleteAll();

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { "Content-Type": "application/json" },
    });
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
        this.handleSyncRequest(connection);
        break;
      case "operation.cancel":
        // TODO: If the process isnt running, reset `isResponding` back to false so we dont get stuck.
        this.agentProcessManager.cancel();
        break;
    }
  }

  private async handleChatMessage(
    connection: Connection,
    payload: ChatMessageEvent,
  ): Promise<void> {
    try {
      const accessResult = await this.assertSessionRepoAccess();
      if (!accessResult.ok) {
        if (accessResult.error.code === REPO_ACCESS_REVOKED_CODE) {
          await this.enforceSessionRevoked();
          this.sendMessage(
            {
              type: "operation.error",
              code: REPO_ACCESS_REVOKED_CODE,
              message: accessResult.error.message,
            },
            connection,
          );
          return;
        }

        if (accessResult.error.code === "GITHUB_AUTH_REQUIRED") {
          this.sendMessage(
            {
              type: "operation.error",
              code: "GITHUB_AUTH_REQUIRED",
              message: accessResult.error.message,
            },
            connection,
          );
          return;
        }

        this.sendMessage(
          {
            type: "operation.error",
            code: "CHAT_MESSAGE_FAILED",
            message: accessResult.error.message,
          },
          connection,
        );
        return;
      }

      await this.ensureReady(); // await any startup steps synchronously.
      const result = await this.agentProcessManager.handleChatMessage(payload);
      if (!result.ok) {
        this.logger.warn("Modeled chat message failure", { fields: { code: result.error.code } });
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
      const { attachments } = result.value;
      // persist the message to db and such.
      const userUiMessage = createUserUiMessage(payload.content, attachments);
      if (!userUiMessage) {
        this.logger.error("Failed to create user UI message");
        return;
      }
      await this.onUserMessageSent(userUiMessage, attachments, connection.id);
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

  private handleSyncRequest(connection: Connection): void {
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
        pendingChunks: this.messageAccumulator.getPendingChunks(),
      },
      connection,
    );
  }

  // ============================================
  // Attachment helpers
  // ============================================

  /**
   * Sends the pending initial message to the agent if one is stored.
   * @returns true if the message was sent, false if not.
   */
  private async maybeSendPendingMessage(): Promise<void> {
    if (!this.agentProcessManager.isConnected()) return;
    const msg = this.state.pendingUserMessage;
    if (!msg) {
      return;
    }
    const { message: userMessage, attachmentIds } = msg;

    const content = getUserMessageTextContent(userMessage);

    const sessionId = this.serverState.sessionId;
    if (!sessionId) return;

    // send to the agent.
    this.logger.info("Sending pending message");
    try {
      this.updatePartialState({ isResponding: true });
      const attachmentRecords =
        await this.agentProcessManager.sendMessageToAgent(
          sessionId,
          content,
          attachmentIds,
        );
      await this.onUserMessageSent(userMessage, attachmentRecords);
      this.updatePartialState({ pendingUserMessage: null });
    } catch (error) {
      this.logger.error("Failed to send pending message", { error });
      this.updatePartialState({
        isResponding: false,
        status: this.synthesizeStatus(),
      });
      this.broadcastMessage({
        type: "operation.error",
        code: "CHAT_MESSAGE_FAILED",
        message: "Failed to handle chat message",
      });
    }
  }

  private async onUserMessageSent(
    message: UIMessage,
    attachmentRecords: AttachmentRecord[],
    connectionId?: string,
  ): Promise<void> {
    const sessionId = this.serverState.sessionId;
    if (!sessionId) return;
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

  private async assertSessionRepoAccess() {
    if (this.sessionAccessRevoked) {
      return {
        ok: false as const,
        error: {
          code: REPO_ACCESS_REVOKED_CODE,
          status: 403 as const,
          message: "Repository access for this session has been revoked.",
          justRevoked: false,
        },
      };
    }

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

  private async enforceSessionRevoked(): Promise<void> {
    if (this.sessionAccessRevoked) {
      return;
    }

    this.sessionAccessRevoked = true;
    this.updatePartialState({
      isResponding: false,
      lastError: REPO_ACCESS_REVOKED_CODE,
    });
    this.broadcastMessage({
      type: "operation.error",
      code: REPO_ACCESS_REVOKED_CODE,
      message: "Repository access for this session has been revoked.",
    });
    this.agentProcessManager.cancel();

    if (!this.serverState.spriteName) {
      return;
    }

    try {
      await this.spritesCoordinator.deleteSprite(this.serverState.spriteName);
    } catch (error) {
      this.logger.error("Failed to delete sprite for revoked session", {
        error,
        fields: { sessionId: this.serverState.sessionId },
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
