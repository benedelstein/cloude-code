import {
  SpritesCoordinator,
  WorkersSprite,
} from "@/lib/sprites";
import {
  type ClientState,
  type AgentInputAttachment,
  type ClaudeAuthState,
  type SessionSettings as SessionSettingsType,
  type SessionSettingsInput,
  SessionSettings,
  ClaudeModel,
  CodexModel,
  type Logger,
  ClientMessage as ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
  SessionInfoResponse,
  SessionPlanResponse,
  SessionStatus,
  type MessageAttachmentRef,
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
import { AttachmentService, type AttachmentRecord } from "@/lib/attachments/attachment-service";
import { buildNetworkPolicy } from "@/lib/sprites/network-policy";
import { handleGitProxy, type GitProxyContext } from "@/lib/git-proxy";
import { ensureValidInstallationToken } from "@/durable-objects/session-agent-github-token";
import { createLogger } from "@/lib/logger";
import { decrypt } from "@/lib/crypto";
import { GitHubAppService } from "@/lib/github/github-app";
import { arrayBufferToBase64 } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ClaudeOAuthError } from "@/lib/claude-oauth-service";
import {
  ensureClaudeCredentialsReadyForSend,
  getClaudeAuthRequiredFromClaudeError,
  getClaudeCredentialsSnapshot,
  refreshClaudeAuthRequired,
} from "./session-agent-claude-auth";
// DISABLED: editor feature imports — security issue (sprite URL set to public)
// import {
//   handleEditorOpen,
//   handleEditorClose,
// } from "./session-agent-editor";
import { updateSessionHistoryData } from "./session-agent-history";
import type { SetPullRequestRequest, UpdatePullRequestRequest } from "@/types/session-agent";
import { AgentProcessManager } from "./lib/agent-process-manager";

const WORKSPACE_DIR = "/home/sprite/workspace";

interface InitRequest {
  sessionId: string;
  userId: string;
  repoFullName: string;
  settings?: SessionSettingsInput;
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
  /** Last Claude credential fingerprint pushed to the sprite this DO instance */
  private lastClaudeCredentialFingerprint: string | null = null;

  initialState: ClientState = {
    sessionId: null,
    userId: null,
    repoFullName: null,
    status: "initializing",
    settings: { provider: "claude-code", model: "opus", maxTokens: 8192 },
    pushedBranch: null,
    pullRequestUrl: null,
    pullRequestNumber: null,
    pullRequestState: null,
    todos: null,
    plan: null,
    pendingUserMessage: null,
    pendingAttachmentIds: [],
    editorUrl: null,
    claudeAuthRequired: null,
    isResponding: false,
    lastError: null,
    baseBranch: null,
    createdAt: new Date(),
  };

  constructor(ctx: DurableObjectState, env: Env, logger: Logger = createLogger("session-agent-do.ts")) {
    super(ctx, env);

    // The Agents SDK allows clients to overwrite state via { type: "cf_agent_state" } WebSocket messages.
    // There is no validation hook before the write, so we intercept at _setStateInternal.
    // When source is a Connection (client), we reject the update entirely.
    const superSetStateInternal = (this as any)._setStateInternal.bind(this);
    (this as any)._setStateInternal = (state: ClientState, source: Connection | "server") => {
      if (source !== "server") {
        this.logger.warn("Rejecting client-initiated state update attempt");
        return;
      }
      return superSetStateInternal(state, source);
    };

    this.logger = logger.scope("session-agent-do.ts");

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
      spritesCoordinator: this.spritesCoordinator,
      messageRepository: this.messageRepository,
      latestPlanRepository: this.latestPlanRepository,
      broadcastMessage: (msg) => this.broadcastMessage(msg),
      updateClientState: (partial) => this.updatePartialState(partial),
      updateServerState: (partial) => this.updateServerState(partial),
      getClientState: () => this.state,
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

  private setClaudeAuthRequired(claudeAuthRequired: ClaudeAuthState | null): void {
    if (claudeAuthRequired) {
      this.lastClaudeCredentialFingerprint = null;
    }
    if (this.state.claudeAuthRequired === claudeAuthRequired) {
      return;
    }
    this.updatePartialState({ claudeAuthRequired });
  }

  // ============================================
  // HTTP Handlers
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.logger.debug(`[HTTP request] ${request.method} ${url.pathname}`);
    const path = url.pathname;

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

    // Sub-resources
    if (path === "/messages" && request.method === "GET") {
      return this.handleGetMessages();
    }
    if (path === "/plan" && request.method === "GET") {
      return this.handleGetPlan();
    }

    // Editor (VS Code) lifecycle — DISABLED: security issue (sprite URL set to public)
    if ((path === "/editor/open" || path === "/editor/close") && request.method === "POST") {
      return new Response("editor feature temporarily disabled", { status: 503 });
    }
    if (path === "/claude-auth/refresh" && request.method === "POST") {
      return this.handleRefreshClaudeAuth();
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
        sessionId: this.serverState.sessionId ?? this.state.sessionId ?? "",
        status: this.state.status,
      },
      connection,
    );

    // Send message history
    const sessionId = this.serverState.sessionId ?? this.state.sessionId;
    if (sessionId) {
      const storedMessages = this.messageRepository.getAllBySession(sessionId);
      this.sendMessage({
        type: "sync.response",
        messages: storedMessages.map((m) => m.message),
        pendingChunks:
          this.agentProcessManager.getPendingChunks().length > 0
            ? this.agentProcessManager.getPendingChunks()
            : undefined,
      }, connection);
    }

    if (sessionId && this.state.settings.provider === "claude-code") {
      this.ctx.waitUntil(this.refreshClaudeAuthRequiredState());
    }

    // Always call ensureReady — idempotent, skips completed steps via serverState checkpoints
    this.ctx.waitUntil(this.ensureReady());
  }

  async onMessage(
    connection: Connection,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const messageStr =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(message);

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
          type: "error",
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
          type: "error",
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
    this.logger.info("WebSocket closed", {
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
  // Provisioning — ensureReady() entry point
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
      return;
    }
    await this.ensureProvisioned();
    await this.ensureAgentStarted();
  }

  private ensureProvisioned(): Promise<void> {
    if (this.ensureProvisionedPromise) return this.ensureProvisionedPromise;
    this.ensureProvisionedPromise = this._provision().finally(() => {
      this.ensureProvisionedPromise = null;
    });
    return this.ensureProvisionedPromise;
  }

  private async _provision(): Promise<void> {
    if (!this.serverState.spriteName) {
      this.updatePartialState({ status: this.synthesizeStatus() });
      this.logger.debug(`Provisioning sprite for session ${this.serverState.sessionId}`);

      const spriteResponse = await this.spritesCoordinator.createSprite({
        name: this.serverState.sessionId!,
      });

      // Lock down outbound network access to known-good domains
      const sprite = new WorkersSprite(
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
      this.updatePartialState({ status: this.synthesizeStatus() });
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

    this.updatePartialState({ status: this.synthesizeStatus() }); // "attaching"

    try {
      // Refresh GitHub installation token (may have expired during hibernation)
      try {
        await this.refreshGitHubToken();
      } catch (error) {
        this.logger.error("Failed to refresh GitHub token during agent start", { error });
      }

      const envVars = await this.buildAgentEnvVars();

      await this.agentProcessManager.startAgentSession({
        spriteName: this.serverState.spriteName,
        agentSessionId: this.serverState.agentSessionId,
        settings: this.state.settings,
        sessionId: this.serverState.sessionId!,
        envVars,
      });

      this.setClaudeAuthRequired(null);
      this.updatePartialState({ status: this.synthesizeStatus() }); // "ready"
      this.broadcastMessage({ type: "session.status", status: "ready" });

      // Send the pending initial message if one was stored
      await this.maybeSendPendingMessage();
    } catch (error) {
      if (error instanceof ClaudeOAuthError) {
        this.setClaudeAuthRequired(getClaudeAuthRequiredFromClaudeError(error));
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to start agent", { error });
      this.updatePartialState({ lastError: errorMessage, status: this.synthesizeStatus() });
      this.broadcastMessage({
        type: "session.status",
        status: this.synthesizeStatus(),
        message: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Builds the provider-specific environment variables for the agent process.
   * Fetches and validates credentials for the configured provider.
   */
  private async buildAgentEnvVars(): Promise<Record<string, string>> {
    const provider = this.state.settings.provider;
    const envVars: Record<string, string> = {};

    switch (provider) {
      case "codex-cli": {
        const codexAuthJson = await this.buildCodexAuthJson();
        if (codexAuthJson) {
          envVars.CODEX_AUTH_JSON = codexAuthJson;
        } else if (this.env.CODEX_AUTH_JSON) {
          envVars.CODEX_AUTH_JSON = this.env.CODEX_AUTH_JSON;
        }
        if (this.env.OPENAI_API_KEY) {
          envVars.OPENAI_API_KEY = this.env.OPENAI_API_KEY;
        }
        break;
      }
      case "claude-code": {
        try {
          const claudeCredentials = await getClaudeCredentialsSnapshot({
            env: this.env,
            logger: this.logger,
            userId: this.state.userId,
          });
          if (!claudeCredentials) {
            throw new Error(
              "Claude authentication required. Connect Claude before creating a session.",
            );
          }
          this.setClaudeAuthRequired(null);
          envVars.CLAUDE_CREDENTIALS_JSON = claudeCredentials.credentialsJson;
          this.lastClaudeCredentialFingerprint = claudeCredentials.fingerprint;
        } catch (error) {
          if (error instanceof ClaudeOAuthError) {
            this.setClaudeAuthRequired(getClaudeAuthRequiredFromClaudeError(error));
          }
          throw error;
        }
        break;
      }
    }

    return envVars;
  }

  /**
   * Clones the repository onto the sprite and configures git remotes.
   * Assumes the sprite is already created and the network policy is set.
   */
  private async cloneRepo(spriteName: string): Promise<void> {
    const repoFullName = this.state.repoFullName!;
    const sessionId = this.serverState.sessionId!;

    const sprite = new WorkersSprite(spriteName, this.env.SPRITES_API_KEY, this.env.SPRITES_API_URL);

    const proxyBaseUrl = `${this.env.WORKER_URL}/git-proxy/${sessionId}`;
    const cloneUrl = `${proxyBaseUrl}/github.com/${repoFullName}.git`;
    const githubRemoteUrl = `https://github.com/${repoFullName}.git`;

    // Check if the repo is already cloned (sprite may be persistent)
    const isCloned = await sprite.execHttp(
      `test -d ${WORKSPACE_DIR}/.git && echo 'exists' || echo 'empty'`,
      {},
    );
    if (isCloned.stdout.includes("exists")) {
      this.logger.info(`Repo ${repoFullName} already cloned on sprite ${spriteName}`);
    } else {
      this.logger.info(`Cloning repo ${repoFullName} on sprite ${spriteName}`);
      await sprite.execHttp(`mkdir -p ${WORKSPACE_DIR}`, {});

      // Fetch a read-only token scoped to contents:read for the initial clone
      const github = new GitHubAppService(this.env, this.logger);
      const cloneToken = await github.getReadOnlyTokenForRepo(repoFullName);
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
        throw new Error(`Clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr}`);
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

    // Use direct GitHub for fetch/pull and proxy URL for push-only operations
    await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git remote set-url origin ${githubRemoteUrl} && git remote set-url --push origin ${cloneUrl}`,
      {},
    );

    // Set up git config for commits
    await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git config user.email "cloude@cloude.dev" && git config user.name "Cloude Code"`,
      {},
    );

    // Configure git to send the proxy auth header only for proxy URL requests
    await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git config --unset-all http.extraHeader || true`,
      {},
    );
    await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git config --unset-all "http.${proxyBaseUrl}/.extraHeader" || true && git config --add "http.${proxyBaseUrl}/.extraHeader" "Authorization: Bearer ${this.gitProxySecret}"`,
      {},
    );
  }

  // ============================================
  // Init handler
  // ============================================

  private async handleInit(request: Request): Promise<Response> {
    // Prevent re-initialization
    if (this.serverState.initialized) {
      this.logger.error("Session already initialized — refusing to re-initialize", {
        fields: { sessionId: this.serverState.sessionId },
      });
      return new Response(
        JSON.stringify({ error: "Session already initialized" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const data = (await request.json()) as InitRequest;

    const provider = data.settings?.provider ?? "claude-code";
    const maxTokens = data.settings?.maxTokens ?? 8192;

    let settings: SessionSettingsType;
    const parsed = SessionSettings.safeParse({
      provider,
      model: data.settings?.model,
      maxTokens,
    });
    if (parsed.success) {
      settings = parsed.data;
    } else {
      // Invalid model — fall back to the provider's default by omitting model
      settings = SessionSettings.parse({ provider, maxTokens });
    }

    if (settings.provider === "claude-code") {
      try {
        await getClaudeCredentialsSnapshot({
          env: this.env,
          logger: this.logger,
          userId: data.userId,
        });
      } catch (error) {
        if (error instanceof ClaudeOAuthError) {
          return new Response(
            JSON.stringify({ error: error.message, code: error.code }),
            { status: error.status, headers: { "Content-Type": "application/json" } },
          );
        }
        throw error;
      }
    }

    // Generate git proxy secret and persist in SQLite (not in ClientState — state is sent to clients)
    this.gitProxySecret = crypto.randomUUID();
    this.secretRepository.set("git_proxy_secret", this.gitProxySecret);

    const pendingAttachmentIds = data.initialAttachmentIds ?? [];
    const pendingUserMessage = await this.buildPendingUserMessage(
      data.sessionId,
      data.initialMessage,
      pendingAttachmentIds,
    );

    // Store the durable initial fields in ClientState
    this.updatePartialState({
      sessionId: data.sessionId,
      userId: data.userId,
      repoFullName: data.repoFullName,
      settings,
      pendingUserMessage,
      pendingAttachmentIds,
      claudeAuthRequired: null,
      // Store the requested base branch; cloneRepo will detect the actual branch and overwrite
      baseBranch: data.branch ?? null,
    });

    // Mark initialized in ServerState
    this.updateServerState({ initialized: true, sessionId: data.sessionId });
    this.updatePartialState({ status: this.synthesizeStatus() });

    // Provision sprite asynchronously
    this.ctx.waitUntil(this.ensureReady());

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ============================================
  // Session info / management handlers
  // ============================================

  private handleGetSession(): Response {
    const sessionId = this.serverState.sessionId ?? this.state.sessionId;
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
        pullRequestUrl: this.state.pullRequestUrl ?? undefined,
        pullRequestNumber: this.state.pullRequestNumber ?? undefined,
        pullRequestState: this.state.pullRequestState ?? undefined,
        editorUrl: this.state.editorUrl ?? undefined,
      } satisfies SessionInfoResponse),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  private handleGetMessages(): Response {
    const sessionId = this.serverState.sessionId ?? this.state.sessionId;
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
    const sessionId = this.serverState.sessionId ?? this.state.sessionId;
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
      pullRequestUrl: data.url,
      pullRequestNumber: data.number,
      pullRequestState: data.state,
    });
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleUpdatePullRequest(request: Request): Promise<Response> {
    const data: UpdatePullRequestRequest = await request.json();
    this.updatePartialState({ pullRequestState: data.state });
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
  // Claude auth handlers
  // ============================================

  private async refreshClaudeAuthRequiredState(): Promise<void> {
    if (this.state.settings.provider !== "claude-code") {
      this.setClaudeAuthRequired(null);
      return;
    }

    try {
      const result = await refreshClaudeAuthRequired({
        env: this.env,
        logger: this.logger,
        userId: this.state.userId,
      });
      this.setClaudeAuthRequired(result.claudeAuthRequired);
    } catch (error) {
      this.logger.error("Failed to refresh Claude auth state", {
        error,
        fields: {
          sessionId: this.serverState.sessionId,
          userId: this.state.userId,
        },
      });
    }
  }

  private async handleRefreshClaudeAuth(): Promise<Response> {
    await this.refreshClaudeAuthRequiredState();
    return Response.json({ ok: true as const });
  }

  private async ensureClaudeCredentialsReadyForSend(
    connection: Connection,
  ): Promise<boolean> {
    if (this.state.settings.provider !== "claude-code") {
      return true;
    }

    const result = await ensureClaudeCredentialsReadyForSend({
      env: this.env,
      logger: this.logger,
      userId: this.state.userId,
      spriteName: this.serverState.spriteName,
      lastFingerprint: this.lastClaudeCredentialFingerprint,
    });

    this.setClaudeAuthRequired(result.claudeAuthRequired);
    if (result.ok) {
      this.lastClaudeCredentialFingerprint = result.nextFingerprint;
      return true;
    }

    this.sendMessage(
      {
        type: "error",
        code: result.errorCode,
        message: result.errorMessage,
      },
      connection,
    );
    return false;
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
        await this.handleChatMessage(connection, {
          content: message.content,
          attachments: message.attachments,
          model: message.model,
        });
        break;
      case "stream.ack":
        // TODO: implement
        break;
      case "sync.request":
        this.handleSyncRequest(connection);
        break;
      case "operation.cancel":
        this.agentProcessManager.cancel();
        break;
    }
  }

  private async handleChatMessage(
    connection: Connection,
    payload: {
      content?: string;
      attachments?: MessageAttachmentRef[];
      model?: string;
    },
  ): Promise<void> {
    const currentStatus = this.synthesizeStatus();
    switch (currentStatus) {
      case "initializing":
      case "provisioning":
      case "cloning":
      case "attaching":
        this.sendMessage(
          {
            type: "error",
            code: "SESSION_TRANSITIONING",
            message: `Session is ${currentStatus}, please wait`,
          },
          connection,
        );
        return;
      case "ready":
        break;
      default: {
        const _exhaustive: never = currentStatus;
        throw new Error(`Unhandled status: ${_exhaustive}`);
      }
    }

    // Reattach agent session if needed (after hibernation)
    if (!this.agentProcessManager.isConnected()) {
      this.logger.info("Agent not connected — triggering ensureReady");
      await this.ensureReady();
    }

    if (!this.agentProcessManager.isConnected()) {
      this.logger.error(`Agent session unavailable after ensureReady: spriteName=${this.serverState.spriteName}, sessionId=${this.serverState.sessionId}`);
      this.sendMessage(
        {
          type: "error",
          code: "NO_AGENT_SESSION",
          message: "Agent session not available",
        },
        connection,
      );
      return;
    }

    if (!await this.ensureClaudeCredentialsReadyForSend(connection)) {
      return;
    }

    const sessionId = this.serverState.sessionId ?? this.state.sessionId;
    if (!sessionId) {
      this.logger.error("No session id");
      return;
    }

    const content = payload.content?.trim();
    const attachmentReferences = payload.attachments ?? [];
    const attachmentService = new AttachmentService(this.env.DB);
    const attachmentRecords = await attachmentService.getByIdsBoundToSession(
      sessionId,
      attachmentReferences.map((attachment) => attachment.attachmentId),
    );

    if (attachmentRecords.length !== attachmentReferences.length) {
      this.logger.error(
        "Some attachments not found: " +
          attachmentReferences.map((a) => a.attachmentId).join(", "),
      );
      this.sendMessage(
        {
          type: "error",
          code: "ATTACHMENT_NOT_FOUND",
          message: "One or more attachments were not found for this session",
        },
        connection,
      );
      return;
    }

    let agentAttachments: AgentInputAttachment[];
    try {
      agentAttachments = await this.resolveAgentAttachments(attachmentRecords);
    } catch (error) {
      this.logger.error("Failed to resolve attachments for chat", { error });
      this.sendMessage(
        {
          type: "error",
          code: "ATTACHMENT_READ_FAILED",
          message: "Failed to read one or more attachments",
        },
        connection,
      );
      return;
    }

    const messageParts: UIMessage["parts"] = [];
    if (content) {
      messageParts.push({ type: "text", text: content });
    }
    for (const attachment of attachmentRecords) {
      messageParts.push({
        type: "file",
        mediaType: attachment.mediaType,
        filename: attachment.filename,
        url: this.buildAttachmentContentUrl(attachment.id),
      } as UIMessage["parts"][number]);
    }

    // Store and broadcast the user message
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: messageParts,
    };
    const stored = this.messageRepository.create(sessionId, userMessage);
    this.broadcastMessage(
      { type: "user.message", message: stored.message },
      [connection.id],
    );

    // Sync to D1: update last_message_at and generate title from first message
    const synthesizedMessageContent = this.toHistorySyncContent(content, attachmentRecords);
    this.ctx.waitUntil(
      updateSessionHistoryData({
        database: this.env.DB,
        anthropicApiKey: this.env.ANTHROPIC_API_KEY,
        logger: this.logger,
        sessionId,
        messageContent: synthesizedMessageContent,
        messageRepository: this.messageRepository,
      }),
    );

    // Validate and apply model switch (if requested and different from current)
    let modelForAgent: string | undefined;
    if (payload.model && payload.model !== this.state.settings.model) {
      modelForAgent = this.validateAndApplyModelSwitch(payload.model);
    }

    await this.agentProcessManager.sendMessage(content, agentAttachments, modelForAgent);
  }

  private handleSyncRequest(connection: Connection): void {
    const sessionId = this.serverState.sessionId ?? this.state.sessionId;
    if (!sessionId) {
      this.sendMessage({ type: "sync.response", messages: [] }, connection);
      return;
    }

    const storedMessages = this.messageRepository.getAllBySession(sessionId);
    this.sendMessage(
      {
        type: "sync.response",
        messages: storedMessages.map((m) => m.message),
        pendingChunks:
          this.agentProcessManager.getPendingChunks().length > 0
            ? this.agentProcessManager.getPendingChunks()
            : undefined,
      },
      connection,
    );
  }

  /** Validates the model against the current provider and updates DO state. Returns the validated model, or undefined if invalid. */
  private validateAndApplyModelSwitch(model: string): string | undefined {
    const currentProvider = this.state.settings.provider;

    let validatedModel: string;
    if (currentProvider === "claude-code") {
      const result = ClaudeModel.safeParse(model);
      if (!result.success) {
        this.logger.warn("Invalid Claude model in model switch", { fields: { model } });
        return undefined;
      }
      validatedModel = result.data;
    } else if (currentProvider === "codex-cli") {
      const result = CodexModel.safeParse(model);
      if (!result.success) {
        this.logger.warn("Invalid Codex model in model switch", { fields: { model } });
        return undefined;
      }
      validatedModel = result.data;
    } else {
      this.logger.warn("Unknown provider in model switch", { fields: { provider: currentProvider } });
      return undefined;
    }

    // Update state (auto-syncs to clients via Agents SDK)
    this.updatePartialState({
      settings: { ...this.state.settings, model: validatedModel } as ClientState["settings"],
    });

    this.logger.info("Model updated", {
      fields: { provider: currentProvider, model: validatedModel },
    });
    return validatedModel;
  }

  // ============================================
  // Attachment helpers
  // ============================================

  private async resolveAgentAttachments(
    attachments: AttachmentRecord[],
  ): Promise<AgentInputAttachment[]> {
    const resolved: AgentInputAttachment[] = [];
    for (const attachment of attachments) {
      const object = await this.env.ATTACHMENTS_BUCKET.get(attachment.objectKey);
      if (!object || !object.body) {
        throw new Error(`Attachment content missing for ${attachment.id}`);
      }
      const bytes = await object.arrayBuffer();
      const base64 = arrayBufferToBase64(bytes);
      resolved.push({
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        dataUrl: `data:${attachment.mediaType};base64,${base64}`,
      });
    }
    return resolved;
  }

  private async buildPendingUserMessage(
    sessionId: string,
    initialMessage: string | undefined,
    attachmentIds: string[],
  ): Promise<UIMessage | null> {
    const content = initialMessage?.trim();
    if (!content && attachmentIds.length === 0) {
      return null;
    }

    let attachmentRecords: AttachmentRecord[] = [];
    if (attachmentIds.length > 0) {
      const attachmentService = new AttachmentService(this.env.DB);
      attachmentRecords = await attachmentService.getByIdsBoundToSession(
        sessionId,
        attachmentIds,
      );
      if (attachmentRecords.length !== attachmentIds.length) {
        this.logger.error(
          `Some pending attachments missing during init: ${attachmentIds.join(", ")}`,
        );
      }
    }

    return this.createUserMessage(content, attachmentRecords);
  }

  private createUserMessage(
    content: string | undefined,
    attachments: AttachmentRecord[],
    id: string = crypto.randomUUID(),
  ): UIMessage | null {
    const messageParts: UIMessage["parts"] = [];
    if (content) {
      messageParts.push({ type: "text", text: content });
    }
    for (const attachment of attachments) {
      messageParts.push({
        type: "file",
        mediaType: attachment.mediaType,
        filename: attachment.filename,
        url: this.buildAttachmentContentUrl(attachment.id),
      } as UIMessage["parts"][number]);
    }

    if (messageParts.length === 0) {
      return null;
    }

    return { id, role: "user", parts: messageParts };
  }

  private getUserMessageTextContent(message: UIMessage | null): string | undefined {
    if (!message) {
      return undefined;
    }

    const text = message.parts
      .flatMap((part) =>
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part
          ? [String(part.text)]
          : [],
      )
      .join("")
      .trim();

    return text || undefined;
  }

  /** Sends the pending initial message to the agent if one is stored. */
  private async maybeSendPendingMessage(): Promise<void> {
    if (!this.agentProcessManager.isConnected()) return;

    const content = this.getUserMessageTextContent(this.state.pendingUserMessage);
    const pendingAttachmentIds = this.state.pendingAttachmentIds ?? [];
    if (!content && pendingAttachmentIds.length === 0) return;

    const sessionId = this.serverState.sessionId ?? this.state.sessionId;
    if (!sessionId) return;

    const attachmentService = new AttachmentService(this.env.DB);
    const attachmentRecords = await attachmentService.getByIdsBoundToSession(
      sessionId,
      pendingAttachmentIds,
    );
    if (attachmentRecords.length !== pendingAttachmentIds.length) {
      this.logger.error(
        `Some pending attachments not found: ${pendingAttachmentIds.join(", ")}`,
      );
      this.updatePartialState({ pendingUserMessage: null, pendingAttachmentIds: [] });
      return;
    }

    let agentAttachments: AgentInputAttachment[];
    try {
      agentAttachments = await this.resolveAgentAttachments(attachmentRecords);
    } catch (error) {
      this.logger.error("Failed to resolve pending attachments", { error });
      this.updatePartialState({ pendingUserMessage: null, pendingAttachmentIds: [] });
      return;
    }

    const userMessage =
      this.state.pendingUserMessage ?? this.createUserMessage(content, attachmentRecords);
    if (!userMessage) {
      this.updatePartialState({ pendingUserMessage: null, pendingAttachmentIds: [] });
      return;
    }

    const stored = this.messageRepository.create(sessionId, userMessage);
    this.broadcastMessage({ type: "user.message", message: stored.message });

    // Clear pending message from state (after broadcast so client has the real message)
    this.updatePartialState({ pendingUserMessage: null, pendingAttachmentIds: [] });

    // Sync to D1 history and generate title
    const historyContent = this.toHistorySyncContent(content, attachmentRecords);
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

    // Send to vm-agent
    this.logger.info(
      `Sending pending message: contentLength=${content?.length ?? 0} attachments=${agentAttachments.length}`,
    );
    await this.agentProcessManager.sendMessage(content, agentAttachments);
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

  private buildAttachmentContentUrl(attachmentId: string): string {
    return `/attachments/${attachmentId}/content`;
  }

  // ============================================
  // GitHub token helpers
  // ============================================

  private gitProxyContext(): GitProxyContext {
    return {
      gitProxySecret: this.gitProxySecret,
      repoFullName: this.state.repoFullName,
      sessionId: this.serverState.sessionId ?? this.state.sessionId,
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

  /**
   * Build Codex auth.json content from per-user OpenAI OAuth tokens stored in D1.
   * Returns null if no per-user tokens are found.
   */
  private async buildCodexAuthJson(): Promise<string | null> {
    const userId = this.state.userId;
    if (!userId) return null;

    const row = await this.env.DB.prepare(
      `SELECT encrypted_access_token, encrypted_refresh_token, encrypted_id_token, token_expires_at
       FROM openai_tokens WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{
        encrypted_access_token: string;
        encrypted_refresh_token: string | null;
        encrypted_id_token: string | null;
        token_expires_at: string | null;
      }>();

    if (!row) return null;

    const accessToken = await decrypt(row.encrypted_access_token, this.env.TOKEN_ENCRYPTION_KEY);
    const refreshToken = row.encrypted_refresh_token
      ? await decrypt(row.encrypted_refresh_token, this.env.TOKEN_ENCRYPTION_KEY)
      : undefined;
    const idToken = row.encrypted_id_token
      ? await decrypt(row.encrypted_id_token, this.env.TOKEN_ENCRYPTION_KEY)
      : undefined;

    const authJson: Record<string, unknown> = {
      auth_mode: "chatgpt",
      tokens: {
        access_token: accessToken,
        ...(refreshToken && { refresh_token: refreshToken }),
        ...(idToken && { id_token: idToken }),
        ...(row.token_expires_at && { expires_at: row.token_expires_at }),
      },
    };

    return JSON.stringify(authJson);
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
