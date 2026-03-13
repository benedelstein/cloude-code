import {
  SpritesCoordinator,
  WorkersSprite,
  SpriteWebsocketSession,
  SpriteServerMessage,
} from "@/lib/sprites";
import {
  type AgentState,
  type AgentInputAttachment,
  type ClaudeAuthState,
  type SessionSettings as SessionSettingsType,
  type SessionSettingsInput,
  SessionSettings,
  type Logger,
  ClientMessage as ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type AgentOutput,
  decodeAgentOutput,
  encodeAgentInput,
  // Session,
  SessionInfoResponse,
  SessionStatus,
  type MessageAttachmentRef,
} from "@repo/shared";
import type { Env } from "@/types";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";
import VM_AGENT_CODEX_SCRIPT from "@repo/vm-agent/dist/vm-agent-codex.bundle.js";
import { Agent, type Connection } from "agents";
import { MessageRepository } from "./repositories/message-repository";
import { SecretRepository } from "./repositories/secret-repository";
import { migrateAll } from "./repositories/schema-manager";
import { AttachmentService, type AttachmentRecord } from "@/lib/attachments/attachment-service";

import { buildNetworkPolicy } from "@/lib/sprites/network-policy";
import { MessageAccumulator } from "@/lib/message-accumulator";
import {
  handleGitProxy,
  ensureValidToken,
  type GitProxyContext,
} from "@/lib/git-proxy";
import { logger as defaultLogger } from "@/lib/logger";
import { decrypt } from "@/lib/crypto";
import { GitHubAppService } from "@/lib/github/github-app";
import { SessionHistoryService } from "@/lib/session-history";
import { generateSessionTitle } from "@/lib/generate-session-title";
import { arrayBufferToBase64 } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ClaudeOAuthError } from "@/lib/claude-oauth-service";
import {
  ensureClaudeCredentialsReadyForSend,
  getClaudeAuthRequiredFromClaudeError,
  getClaudeCredentialsSnapshot,
  refreshClaudeAuthRequired,
} from "./session-agent-claude-auth";
import {
  handleEditorOpen,
  handleEditorClose,
} from "./session-agent-editor";

const WORKSPACE_DIR = "/home/sprite/workspace";
const HOME_DIR = "/home/sprite";
const loggerName = "session-agent-do.ts";

/** IMPORTANT: AgentState IS PROPAGATED TO CLIENTS. DO NOT PUT SENSITIVE DATA HERE. */

interface InitRequest {
  sessionId: string;
  userId: string;
  repoFullName: string;
  settings?: SessionSettingsInput;
  branch?: string;
  initialMessage?: string;
  initialAttachmentIds?: string[];
}

export class SessionAgentDO extends Agent<Env, AgentState> {
  private readonly logger: Logger;
  private readonly spritesCoordinator: SpritesCoordinator;
  private readonly messageRepository: MessageRepository;
  private readonly secretRepository: SecretRepository;
  /** vm-agent session running on the sprite */
  private agentSession: SpriteWebsocketSession | null = null;
  /** Mutex for reattachment to prevent race conditions */
  private reattachPromise: Promise<void> | null = null;
  /** Accumulator for building UIMessage from stream chunks */
  private messageAccumulator: MessageAccumulator = new MessageAccumulator();
  /** Buffer of raw stream chunks for the current in-progress message, replayed on reconnect */
  private pendingChunks: unknown[] = [];
  /** Buffers partial vm-agent stdout until a full NDJSON line arrives. */
  private agentStdoutBuffer = "";
  /** GitHub App installation access token (in-memory cache, persisted in SQLite) */
  private githubToken: string | null = null;
  /** Random nonce for git proxy auth (in-memory cache, persisted in SQLite secrets) */
  private gitProxySecret: string | null = null;
  /** Connection token for the VS Code editor (in-memory cache, persisted in SQLite secrets) */
  private editorToken: string | null = null;
  /** Last Claude credential pair applied to the sprite for this DO instance */
  private lastClaudeCredentialFingerprint: string | null = null;

  initialState: AgentState = {
    sessionId: "",
    userId: "",
    repoFullName: "",
    spriteName: null,
    claudeSessionId: null,
    agentProcessId: null,
    status: "provisioning",
    settings: { provider: "claude-code", model: "opus", maxTokens: 8192 },
    pushedBranch: null,
    pullRequestUrl: null,
    pullRequestNumber: null,
    pullRequestState: null,
    pendingUserMessage: null,
    pendingAttachmentIds: [],
    editorUrl: null,
    claudeAuthRequired: null,
    isResponding: false,
    baseBranch: null,
    createdAt: new Date(),
  };

  constructor(ctx: DurableObjectState, env: Env, logger: Logger = defaultLogger) {
    super(ctx, env);
    this.logger = logger;

    const sql = this.sql.bind(this);
    this.messageRepository = new MessageRepository(sql);
    this.secretRepository = new SecretRepository(sql);
    this.spritesCoordinator = new SpritesCoordinator({
      apiKey: this.env.SPRITES_API_KEY,
    });

    migrateAll([this.messageRepository, this.secretRepository]);

    // Load secrets from SQLite into memory
    this.githubToken = this.secretRepository.get("github_token");
    this.gitProxySecret = this.secretRepository.get("git_proxy_secret");
    this.editorToken = this.secretRepository.get("editor_token");
  }

  private getConnectedAgentSession(): SpriteWebsocketSession | null {
    const currentAgentSession = this.agentSession;
    if (!currentAgentSession || !currentAgentSession.isConnected) {
      return null;
    }
    return currentAgentSession;
  }

  private updatePartialState(partial: Partial<AgentState>): void {
    this.setState({ ...this.state, ...partial });
  }

  private updateStatus(status: SessionStatus): void {
    this.updatePartialState({ status });
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
    this.logger.debug(`[HTTP request] ${request.method} ${url.pathname}`, {
      loggerName,
    });
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
        this.updatePartialState({pushedBranch: result.pushedBranch });
        this.broadcastMessage({
          type: "branch.pushed",
          branch: result.pushedBranch,
          repoFullName: this.state.repoFullName ?? "",
        });
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

    // Editor (VS Code) lifecycle
    if (path === "/editor/open" && request.method === "POST") {
      const result = await handleEditorOpen(this.editorContext());
      this.editorToken = result.editorToken;
      return result.response;
    }
    if (path === "/editor/close" && request.method === "POST") {
      const result = await handleEditorClose(this.editorContext());
      this.editorToken = result.editorToken;
      return result.response;
    }
    if (path === "/claude-auth/refresh" && request.method === "POST") {
      return this.handleRefreshClaudeAuth();
    }

    // Pass unhandled requests to Agent SDK (WebSocket upgrades, internal setup routes, etc.)
    return super.fetch(request);
  }

  // Called by Agent SDK when a new WebSocket connection is established
  onConnect(connection: Connection): void {
    this.logger.debug(`client connected: ${connection.id}`, { loggerName });
    // Send initial connection state
    this.sendMessage({
        type: "connected",
        sessionId: this.state?.sessionId ?? "",
        status: this.state?.status ?? "unknown",
      }, 
      connection
    );

    // Send message history
    if (this.state?.sessionId && this.messageRepository) {
  
      const storedMessages = this.messageRepository.getAllBySession(
        this.state.sessionId,
      );
      this.sendMessage({
        type: "sync.response",
        messages: storedMessages.map((m) => m.message),
        pendingChunks: this.pendingChunks.length > 0 ? this.pendingChunks : undefined,
      }, connection);
    }

    if (this.state.sessionId && this.state.settings.provider === "claude-code") {
      this.ctx.waitUntil(this.refreshClaudeAuthRequiredState());
    }

    // Proactively trigger reattachment when client connects (non-blocking)
    if (
      this.state.status === "ready" &&
      !this.getConnectedAgentSession() &&
      this.state.spriteName
    ) {
      this.ctx.waitUntil(this.reattachAgentSession(this.state.spriteName));
    } else {
      this.logger.debug(
        `reattachAgentSession not triggered: status=${this.state.status}, spriteName=${this.state.spriteName}`,
        { loggerName },
      );
    }
  }

  // Agent SDK WebSocket handlers
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
        loggerName,
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
        loggerName,
        fields: {
          connectionId: connection.id,
          preview: messageStr.slice(0, 200),
          issues: parsedMessage.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      this.sendMessage({
        type: "error",
        code: "INVALID_MESSAGE",
        message: "unknown request",
      }, connection);
      return;
    }

    try {
      await this.handleClientMessage(connection, parsedMessage.data);
    } catch (error) {
      this.logger.error("Failed to handle websocket message", {
        loggerName,
        error,
        fields: {
          connectionId: connection.id,
          type: parsedMessage.data.type,
        },
      });
      this.sendMessage({
        type: "error",
        code: "MESSAGE_HANDLER_ERROR",
        message: "request failed",
      }, connection);
    }
  }

  onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    // Cleanup if needed
    this.logger.info("WebSocket closed", {
      loggerName,
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
      loggerName,
      error: error ?? connectionOrError,
    });
  }

  private async handleInit(request: Request): Promise<Response> {
    // Prevent re-initialization
    if (this.state.sessionId) {
      return new Response(
        JSON.stringify({ error: "Session already initialized" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const data = (await request.json()) as InitRequest;

    const provider = data.settings?.provider ?? "claude-code";
    const maxTokens = data.settings?.maxTokens ?? 8192;

    // Let the discriminated union's per-provider defaults handle the model
    // when the caller doesn't supply one or supplies an invalid one.
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
            {
              status: error.status,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        throw error;
      }
    }

    // Generate git proxy secret and persist in SQLite (not in state — state is sent to clients)
    this.gitProxySecret = crypto.randomUUID();
    this.secretRepository.set("git_proxy_secret", this.gitProxySecret);

    const pendingAttachmentIds = data.initialAttachmentIds ?? [];
    const pendingUserMessage = await this.buildPendingUserMessage(
      data.sessionId,
      data.initialMessage,
      pendingAttachmentIds,
    );

    // Initialize agent state
    this.updatePartialState({
      sessionId: data.sessionId,
      userId: data.userId,
      repoFullName: data.repoFullName,
      spriteName: null,
      claudeSessionId: null,
      agentProcessId: null,
      status: "provisioning",
      settings,
      pendingUserMessage,
      pendingAttachmentIds,
      claudeAuthRequired: null,
    });

    // Provision sprite asynchronously
    this.ctx.waitUntil(this.provisionSprite(data.sessionId, data.repoFullName, data.branch));

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async provisionSprite(
    sessionId: string,
    repoFullName: string,
    branch?: string,
  ): Promise<void> {
    this.logger.debug(
      `Provisioning sprite for session ${sessionId} and repo ${repoFullName}`,
      { loggerName },
    );
    this.getConnections();
    try {
  

      if (!this.gitProxySecret) {
        // this should never happen, but just in case
        throw new Error(
          "gitProxySecret is not set — cannot provision sprite without it",
        );
      }

      const spriteResponse = await this.spritesCoordinator.createSprite({
        name: `${sessionId}`,
        env: {},
      });

      const sprite = new WorkersSprite(
        spriteResponse.name,
        this.env.SPRITES_API_KEY,
        this.env.SPRITES_API_URL,
      );

      // Lock down outbound network access to known-good domains
      const workerHostname = new URL(this.env.WORKER_URL).hostname;
      const networkPolicy = buildNetworkPolicy([
        { domain: workerHostname, action: "allow" },
      ]);
      await sprite.setNetworkPolicy(networkPolicy);

      // Build git URLs: direct GitHub for fast reads, proxy for validated pushes
      const proxyBaseUrl = `${this.env.WORKER_URL}/git-proxy/${sessionId}`;
      const cloneUrl = `${proxyBaseUrl}/github.com/${repoFullName}.git`;
      const githubRemoteUrl = `https://github.com/${repoFullName}.git`;

      // Clone the repo
      // check if the repo is already cloned
      const isCloned = await sprite.execHttp(
        `test -d ${WORKSPACE_DIR}/.git && echo 'exists' || echo 'empty'`,
        {},
      );
      if (isCloned.stdout.includes("exists")) {
        this.logger.info(
          `Repo ${repoFullName} already cloned on sprite ${spriteResponse.name}`,
          { loggerName },
        );
      } else {
        this.updatePartialState({
          spriteName: spriteResponse.name,
          status: "cloning",
        });

        this.broadcastMessage({
          type: "session.status",
          status: "cloning",
          message: `Cloning repo ${repoFullName} on sprite ${spriteResponse.name}`,
        });
        this.logger.info(
          `Cloning repo ${repoFullName} on sprite ${spriteResponse.name}`,
          { loggerName },
        );
        await sprite.execHttp(`mkdir -p ${WORKSPACE_DIR}`, {});

        // Fetch a read-only token scoped to contents:read for the initial clone
        const github = new GitHubAppService(this.env, this.logger);
        const cloneToken = await github.getReadOnlyTokenForRepo(repoFullName);
        const basicAuth = btoa(`x-access-token:${cloneToken}`);

        // Also refresh the write token for the proxy (used after clone)
        await this.refreshGitHubToken();
        const cloneStart = Date.now();
        const branchFlag = branch ? `--branch ${branch} ` : "";
        const cloneResult = await sprite.execHttp(
          `git -c http.extraHeader="Authorization: Basic ${basicAuth}" clone --single-branch ${branchFlag}${githubRemoteUrl} ${WORKSPACE_DIR}`,
          {},
        );
        this.logger.info(
          `Clone completed in ${((Date.now() - cloneStart) / 1000).toFixed(1)}s: exitCode=${cloneResult.exitCode}, stderr=${cloneResult.stderr.slice(0, 500)}`,
          { loggerName },
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
      const baseBranch = branchResult.stdout.trim() || "main";
      this.updatePartialState({baseBranch });

      // Use direct GitHub for fetch/pull and proxy URL for push-only operations.
      await sprite.execHttp(
        `cd ${WORKSPACE_DIR} && git remote set-url origin ${githubRemoteUrl} && git remote set-url --push origin ${cloneUrl}`,
        {},
      );

      // Set up git config for commits
      await sprite.execHttp(
        `cd ${WORKSPACE_DIR} && git config user.email "cloude@cloude.dev" && git config user.name "Cloude Code"`,
        {},
      );

      // Configure git to send the proxy auth header only for proxy URL requests.
      await sprite.execHttp(
        `cd ${WORKSPACE_DIR} && git config --unset-all http.extraHeader || true`,
        {},
      );
      await sprite.execHttp(
        `cd ${WORKSPACE_DIR} && git config --unset-all "http.${proxyBaseUrl}/.extraHeader" || true && git config --add "http.${proxyBaseUrl}/.extraHeader" "Authorization: Bearer ${this.gitProxySecret}"`,
        {},
      );

      // this.updateStatus("attaching");
      // this.broadcastMessage({ type: "session.status", status: "attaching" });
      // Start mitmproxy as a session, then vm-agent
      // await this.startMitmproxyOnVM(sprite);
      await this.startAgentOnVM(spriteResponse.name);

      this.updateStatus("ready");
      this.broadcastMessage({ type: "session.status", status: "ready" });

      // If there's a pending initial message, send it to the agent now
      if (this.state.pendingUserMessage || this.state.pendingAttachmentIds.length > 0) {
        this.logger.info("Sending pending initial message to vm-agent", {
          loggerName,
        });
        await this.sendPendingMessage();
      }
    } catch (error) {
      this.logger.error("Failed to provision sprite", { loggerName, error });
      this.updateStatus("error");
      this.broadcastMessage({
        type: "session.status",
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /** Send the pending initial message to the agent and store/broadcast it as a user message. */
  private async sendPendingMessage(): Promise<void> {
    const content = this.getUserMessageTextContent(this.state.pendingUserMessage);
    const pendingAttachmentIds = this.state.pendingAttachmentIds ?? [];
    if (!this.agentSession || !this.state.sessionId) return;
    if (!content && pendingAttachmentIds.length === 0) return;

    const sessionId = this.state.sessionId;
    const attachmentService = new AttachmentService(this.env.DB);
    const attachmentRecords = await attachmentService.getByIdsBoundToSession(
      sessionId,
      pendingAttachmentIds,
    );
    if (attachmentRecords.length !== pendingAttachmentIds.length) {
      this.logger.error(
        `Some pending attachments not found: ${pendingAttachmentIds.join(", ")}`,
        { loggerName },
      );
      this.updatePartialState({
        pendingUserMessage: null,
        pendingAttachmentIds: [],
      });
      return;
    }

    let agentAttachments: AgentInputAttachment[];
    try {
      agentAttachments = await this.resolveAgentAttachments(attachmentRecords);
    } catch (error) {
      this.logger.error("Failed to resolve pending attachments", { loggerName, error });
      this.updatePartialState({
        pendingUserMessage: null,
        pendingAttachmentIds: [],
      });
      return;
    }

    // Store user message and broadcast to all clients

    const userMessage = this.state.pendingUserMessage
      ?? this.createUserMessage(content, attachmentRecords);
    if (!userMessage) {
      this.updatePartialState({
        pendingUserMessage: null,
        pendingAttachmentIds: [],
      });
      return;
    }
    const stored = this.messageRepository.create(
      sessionId,
      userMessage,
    );
    this.broadcastMessage({
      type: "user.message",
      message: stored.message,
    });

    // Clear pending message from state (after broadcast so client has the real message)
    this.updatePartialState({
      pendingUserMessage: null,
      pendingAttachmentIds: [],
    });

    // Sync to D1 history and generate title
    const historyContent = this.toHistorySyncContent(content, attachmentRecords);
    this.ctx.waitUntil(this.syncMessageToHistory(historyContent));

    // Send to vm-agent
    this.logger.info(
      `Sending pending message to vm-agent: contentLength=${content?.length ?? 0} attachments=${agentAttachments.length}`,
      { loggerName },
    );
    this.agentSession.write(
      encodeAgentInput({
        type: "chat",
        message: {
          content,
          attachments: agentAttachments.length > 0 ? agentAttachments : undefined,
        },
      }) + "\n",
    );
  }

  private async startAgentOnVM(spriteName: string): Promise<void> {
    const sprite = new WorkersSprite(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    const provider = this.state.settings.provider;
    const isCodex = provider === "codex-cli";

    let agentScript: string;
    switch (provider) {
      case "codex-cli":
        agentScript = VM_AGENT_CODEX_SCRIPT;
        break;
      case "claude-code":
        agentScript = VM_AGENT_SCRIPT;
        break;
    }
    console.log(`Using agent script: ${provider}`);
    await sprite.writeFile(`${HOME_DIR}/.cloude/agent.js`, agentScript);

    const claudeSessionId = this.state.claudeSessionId;
    const commands = [
      "bun",
      "run",
      `${HOME_DIR}/.cloude/agent.js`,
      ...(!isCodex && claudeSessionId ? [`--sessionId=${claudeSessionId}`] : []), // TODO: SUPPORT SESSION ID FOR CODEX
    ];

    const baseEnv: Record<string, string> = {
      SESSION_ID: this.state.sessionId ?? "",
    };

    if (isCodex) {
      // Try per-user OpenAI OAuth tokens first, then fall back to server-wide env vars
      const codexAuthJson = await this.buildCodexAuthJson();
      if (codexAuthJson) {
        baseEnv.CODEX_AUTH_JSON = codexAuthJson;
      } else if (this.env.CODEX_AUTH_JSON) {
        baseEnv.CODEX_AUTH_JSON = this.env.CODEX_AUTH_JSON;
      }
      if (this.env.OPENAI_API_KEY) {
        baseEnv.OPENAI_API_KEY = this.env.OPENAI_API_KEY;
      }
      baseEnv.CODEX_MODEL = this.state.settings.model;
    } else {
      try {
        const claudeCredentials = await getClaudeCredentialsSnapshot({
          env: this.env,
          logger: this.logger,
          userId: this.state.userId,
        });
        if (!claudeCredentials) {
          throw new Error("Claude authentication required. Connect Claude before creating a session.");
        }
        this.setClaudeAuthRequired(null);
        baseEnv.CLAUDE_CREDENTIALS_JSON = claudeCredentials.credentialsJson;
        this.lastClaudeCredentialFingerprint = claudeCredentials.fingerprint;
      } catch (error) {
        if (error instanceof ClaudeOAuthError) {
          this.setClaudeAuthRequired(getClaudeAuthRequiredFromClaudeError(error));
        }
        throw error;
      }
    }

    this.agentSession = sprite.createSession("env", commands, {
      cwd: WORKSPACE_DIR,
      tty: false,
      env: baseEnv,
    });

    this.setupAgentSessionHandlers();
    await this.agentSession.start();
    this.logger.info(`vm-agent (${provider}) started on sprite ${spriteName}`, { loggerName });
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

    const accessToken = await decrypt(
      row.encrypted_access_token,
      this.env.TOKEN_ENCRYPTION_KEY,
    );
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
        loggerName,
        error,
        fields: { sessionId: this.state.sessionId, userId: this.state.userId },
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
      spriteName: this.state.spriteName,
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

  private setupAgentSessionHandlers(): void {
    if (!this.agentSession) return;

    this.agentSession.onStdout((data: string) => {
      this.handleAgentStdout(data);
    });

    this.agentSession.onStderr((data: string) => {
      this.logger.error(`vm-agent stderr: ${data}`, { loggerName });
    });

    this.agentSession.onExit((code: number) => {
      this.logger.info(`vm-agent exited with code ${code}`, { loggerName });
      this.agentStdoutBuffer = "";
      this.agentSession = null;
      // Clear any in-progress chunk buffer if agent exits mid-stream
      this.pendingChunks = [];
      this.messageAccumulator.reset();
      this.updatePartialState({ isResponding: false });
    });

    this.agentSession.onServerMessage((msg: SpriteServerMessage) => {
      this.handleAgentServerMessage(msg);
    });
  }

  private handleAgentStdout(data: string): void {
    // some messages come in multiple lines, so we need to buffer them until we get a full line.
    this.agentStdoutBuffer += data;
    const lines = this.agentStdoutBuffer.split("\n");
    this.agentStdoutBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;

      try {
        const output = decodeAgentOutput(line);
        this.handleAgentOutput(output);
      } catch {
        // Ignore lines that don't match AgentOutput schema (e.g., TTY echo)
        this.logger.debug(`Skipping invalid agent output: ${line}`, {
          loggerName,
        });
      }
    }
  }

  private handleAgentOutput(output: AgentOutput): void {
    switch (output.type) {
      case "ready": {
        this.broadcastMessage({
          type: "agent.ready",
        });
        break;
      }
      case "error": {
        this.logger.error(`vm-agent error: ${output.error}`, { loggerName });
        this.broadcastMessage({
          type: "error",
          code: "AGENT_ERROR",
          message: output.error,
        });
        break;
      }
      case "debug": {
        this.logger.debug(`[vm-agent debug] ${output.message}`, { loggerName });
        break;
      }
      case "stream": {
        // Buffer chunk for reconnect replay
        this.pendingChunks.push(output.chunk);

        this.broadcastMessage({
          type: "agent.chunk",
          chunk: output.chunk,
        });

        // Accumulate chunks into UIMessage
        const isFinished = this.messageAccumulator.process(output.chunk);
        if (isFinished) {
          // Save the accumulated message to DB
          const message = this.messageAccumulator.getMessage();
          if (message && this.state.sessionId && this.messageRepository) {
            const stored = this.messageRepository.create(
              this.state.sessionId,
              message,
            );

            // Broadcast finish event with the complete message
            this.broadcastMessage({
              type: "agent.finish",
              message: stored.message,
            });
          }

          // Reset accumulator and chunk buffer for next message
          this.messageAccumulator.reset();
          this.pendingChunks = [];
          this.updatePartialState({ isResponding: false });
        }
        break;
      }
      case "sessionId": {
        // Store Claude's session ID for resuming later
        this.logger.info(`Storing Claude session ID: ${output.sessionId}`, {
          loggerName,
        });
        this.updatePartialState({claudeSessionId: output.sessionId });
        break;
      }
    }
  }

  private handleAgentServerMessage(msg: SpriteServerMessage): void {
    switch (msg.type) {
      case "session_info":
        this.logger.info(`vm-agent session id: ${JSON.stringify(msg.session_id)}`, {
          loggerName,
        });
        this.updatePartialState({agentProcessId: msg.session_id });
        break;
      default:
        break;
    }
  }

  private gitProxyContext(): GitProxyContext {
    return {
      gitProxySecret: this.gitProxySecret,
      repoFullName: this.state.repoFullName,
      sessionId: this.state.sessionId,
      githubToken: this.githubToken,
      pushedBranch: this.state.pushedBranch,
      env: this.env,
      secretRepository: this.secretRepository,
    };
  }

  private async refreshGitHubToken(): Promise<void> {
    const token = await ensureValidToken(this.gitProxyContext());
    if (token) {
      this.githubToken = token;
    }
  }

  private handleGetSession(): Response {
    if (!this.state.sessionId || !this.state.repoFullName) {
      return new Response("Session not found", { status: 404 });
    }

    return new Response(
      JSON.stringify({
        sessionId: this.state.sessionId,
        status: this.state.status,
        repoFullName: this.state.repoFullName,
        baseBranch: this.state.baseBranch ?? undefined,
        pushedBranch: this.state.pushedBranch ?? undefined,
        pullRequestUrl: this.state.pullRequestUrl ?? undefined,
        pullRequestNumber: this.state.pullRequestNumber ?? undefined,
        pullRequestState: this.state.pullRequestState ?? undefined,
        editorUrl: this.state.editorUrl ?? undefined,
      } satisfies SessionInfoResponse),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  private handleGetMessages(): Response {


    if (!this.state.sessionId) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const storedMessages = this.messageRepository.getAllBySession(
      this.state.sessionId,
    );
    return new Response(JSON.stringify(storedMessages.map((m) => m.message)), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleSetPullRequest(request: Request): Promise<Response> {
    const data = (await request.json()) as {
      url: string;
      number: number;
      state: "open" | "merged" | "closed";
    };
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
    const data = (await request.json()) as {
      state: "open" | "merged" | "closed";
    };
    this.updatePartialState({
      pullRequestState: data.state,
    });
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleDeleteSession(): Promise<Response> {


    // Close editor if open
    if (this.state.editorUrl) {
      const result = await handleEditorClose(this.editorContext());
      this.editorToken = result.editorToken;
    }

    // Clean up sprite
    if (this.state.spriteName) {
      try {
        await this.spritesCoordinator.deleteSprite(this.state.spriteName);
      } catch (error) {
        this.logger.error("Failed to delete sprite", { loggerName, error });
      }
    }

    // Clear messages
    if (this.state.sessionId) {
      const sessionId = this.state.sessionId;
      this.sql`DELETE FROM messages WHERE session_id = ${sessionId}`;
    }

    // Reset state
    this.updatePartialState({
      status: "terminated",
    });

    // maybe delete the sprite.

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ============================================
  // Client Message Handlers
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
        });
        break;
      case "stream.ack":
        // TODO: implement
        break;
      case "sync.request":
        this.handleSyncRequest(connection);
        break;
      case "operation.cancel":
        this.handleOperationCancel();
        break;
    }
  }

  private async handleChatMessage(
    connection: Connection,
    payload: {
      content?: string;
      attachments?: MessageAttachmentRef[];
    },
  ): Promise<void> {
    switch (this.state.status) {
      case "provisioning":
      case "cloning":
      case "syncing":
      case "attaching":
      case "waking":
        this.sendMessage(
          {
            type: "error",
            code: "SESSION_TRANSITIONING",
            message: `Session is ${this.state.status}, please wait`,
          },
          connection,
        );
        return;
      case "hibernating":
      case "error":
      case "terminated":
        this.sendMessage({
            type: "error",
            code: "SESSION_NOT_READY",
            message: `Session is ${this.state.status}`,
          },
        connection
      );
        return;
      case "ready":
        break;
      default: {
        const _exhaustive: never = this.state.status;
        throw new Error(`Unhandled status: ${_exhaustive}`);
      }
    }

    // Reattach agent session if needed (after hibernation)
    if (!this.getConnectedAgentSession() && this.state.spriteName) {
      await this.reattachAgentSession(this.state.spriteName);
    }

    const currentAgentSession = this.getConnectedAgentSession();
    if (!currentAgentSession || !currentAgentSession.isConnected) {
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

    // Store user message with parts format

    if (!this.state.sessionId) {
      this.logger.error("No session id", { loggerName });
      return;
    }
    const sessionId = this.state.sessionId;
    const content = payload.content?.trim();
    const attachmentReferences = payload.attachments ?? [];
    const attachmentService = new AttachmentService(this.env.DB);
    const attachmentRecords = await attachmentService.getByIdsBoundToSession(
      sessionId,
      attachmentReferences.map((attachment) => attachment.attachmentId),
    );

    if (attachmentRecords.length !== attachmentReferences.length) {
      this.logger.error("Some attachments not found: " + attachmentReferences.map((attachment) => attachment.attachmentId).join(", "), { loggerName });
      this.sendMessage(
        {
          type: "error",
          code: "ATTACHMENT_NOT_FOUND",
          message: "One or more attachments were not found for this session",
        }, connection);
      return;
    }

    let agentAttachments: AgentInputAttachment[];
    try {
      agentAttachments = await this.resolveAgentAttachments(attachmentRecords);
    } catch (error) {
      this.logger.error("Failed to resolve attachments for chat", {
        loggerName,
        error,
      });
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

    // We also need to broadcast this to all clients who are not this connected client.
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: messageParts,
    };
    const stored = this.messageRepository.create(
      sessionId,
      userMessage,
    );
    this.broadcastMessage(
      {
        type: "user.message",
        message: stored.message,
      },
      [connection.id],
    );

    // Sync to D1: update last_message_at and generate title from first message
    const historyContent = this.toHistorySyncContent(content, attachmentRecords);
    this.ctx.waitUntil(this.syncMessageToHistory(historyContent));

    // Send to vm-agent
    this.updatePartialState({ isResponding: true });
    const encoded = encodeAgentInput({
      type: "chat",
      message: {
        content,
        attachments: agentAttachments.length > 0 ? agentAttachments : undefined,
      },
    }) + "\n";
    try {
      currentAgentSession.write(encoded);
      return;
    } catch (error) {
      this.logger.error("Failed to write to vm-agent, attempting reattach", {
        loggerName,
        error,
      });
      this.agentSession = null;
    }

    if (this.state.spriteName) {
      await this.reattachAgentSession(this.state.spriteName);
    }

    const reattachedAgentSession = this.getConnectedAgentSession();
    if (!reattachedAgentSession) {
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

    try {
      reattachedAgentSession.write(encoded);
    } catch (error) {
      this.logger.error("Failed to write to vm-agent after reattach", {
        loggerName,
        error,
      });
      this.agentSession = null;
      this.sendMessage(
        {
          type: "error",
          code: "NO_AGENT_SESSION",
          message: "Agent session unavailable, please try again",
        },
        connection,
      );
    }
  }

  private async syncRepository(sprite: WorkersSprite): Promise<void> {
    // TODO: MAKE THIS ONE SCRIPT/BASH LINE
    // Stash any local changes
    await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git stash --include-untracked`,
      {},
    );
    // Fetch and pull latest from main
    await sprite.execHttp(`cd ${WORKSPACE_DIR} && git checkout main`, {});
    await sprite.execHttp(
      `cd ${WORKSPACE_DIR} && git pull origin main --rebase || true`,
      {},
    );
    // Restore stashed changes
    await sprite.execHttp(`cd ${WORKSPACE_DIR} && git stash pop || true`, {});
  }

  private async reattachAgentSession(spriteName: string): Promise<void> {
    // Mutex pattern: if already reattaching, wait for that to complete
    if (this.reattachPromise) {
      return this.reattachPromise;
    }

    this.reattachPromise = this._doReattach(spriteName);
    try {
      await this.reattachPromise;
    } finally {
      this.reattachPromise = null;
    }
  }

  private async _doReattach(spriteName: string): Promise<void> {

    try {
      const sprite = new WorkersSprite(
        spriteName,
        this.env.SPRITES_API_KEY,
        this.env.SPRITES_API_URL,
      );

      // Restart mitmproxy if not running (it doesn't survive hibernation)
      // if (!this.mitmSession) {
      //   await this.startMitmproxyOnVM(sprite);
      // }

      // Refresh GitHub token before sync (may have expired during hibernation)
      try {
        await this.refreshGitHubToken();
      } catch (error) {
        this.logger.error("Failed to refresh GitHub token", {
          loggerName,
          error,
        });
      }

      // Sync repository before reattaching
      this.updateStatus("syncing");
      this.broadcastMessage({ type: "session.status", status: "syncing" });
      await this.syncRepository(sprite);

      // Set status to attaching
      this.updateStatus("attaching");
      this.broadcastMessage({ type: "session.status", status: "attaching" });
      const sessions = await this.spritesCoordinator.listSessions(spriteName);
      const existingSession = sessions.find(
        (s) => s.id === String(this.state?.agentProcessId),
      );

      // Check if other clients are connected (current client is already counted)
      const connectionCount = [...this.getConnections()].length;
      const otherClientsConnected = connectionCount > 1;

      if (existingSession && otherClientsConnected) {
        // Multiplayer: attach to existing session to not disrupt others
        this.logger.info(
          `${connectionCount} clients connected and vm-agent session exists, attaching to existing session ${existingSession.id}`,
          { loggerName },
        );
        this.agentSession = sprite.attachSession(
          String(existingSession.id),
          {},
        );
        this.setupAgentSessionHandlers();
        await this.agentSession.start();
      } else {
        // Solo: start fresh with latest script (old session orphaned)
        this.logger.info("No other clients connected, starting fresh vm-agent", {
          loggerName,
        });
        await this.startAgentOnVM(spriteName);
      }

      // Set status back to ready
      this.setClaudeAuthRequired(null);
      this.updateStatus("ready");
      this.broadcastMessage({ type: "session.status", status: "ready" });
    } catch (error) {
      if (error instanceof ClaudeOAuthError) {
        this.setClaudeAuthRequired(getClaudeAuthRequiredFromClaudeError(error));
      }
      this.logger.error("Failed to reattach agent session", { loggerName, error });
      this.updateStatus("ready");
      this.broadcastMessage({ type: "session.status", status: "ready" });
      this.broadcastMessage({
        type: "error",
        code: "reattach_failed",
        message: `Failed to reattach: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // ============================================
  // Editor (VS Code) Lifecycle
  // ============================================

  private editorContext() {
    return {
      spriteName: this.state.spriteName,
      editorUrl: this.state.editorUrl,
      editorToken: this.editorToken,
      env: this.env,
      logger: this.logger,
      secretRepository: this.secretRepository,
      setEditorUrl: (url: string | null) => this.updatePartialState({editorUrl: url }),
      broadcastEditorReady: (url: string, token: string) =>
        this.broadcastMessage({ type: "editor.ready", url, token }),
    };
  }

  /**
   * Handles a client request to sync message history.
   * @param connection The connection to the client.
   */
  private handleSyncRequest(connection: Connection): void {
    if (!this.state?.sessionId) {
      this.sendMessage({
        type: "sync.response",
        messages: [],
      }, connection);
      return;
    }

    const storedMessages = this.messageRepository.getAllBySession(
      this.state.sessionId,
    );
    this.sendMessage({
      type: "sync.response",
      messages: storedMessages.map((m) => m.message),
      pendingChunks: this.pendingChunks.length > 0 ? this.pendingChunks : undefined,
    }, connection);
  }

  private handleOperationCancel(): void {
    if (this.agentSession) {
      this.agentSession.write(encodeAgentInput({ type: "cancel" }) + "\n");
    }
  }

  /** Sync a user message to D1: update last_message_at, and set title from first message. */
  private async syncMessageToHistory(content: string): Promise<void> {
    const sessionId = this.state.sessionId;
    if (!sessionId) return;

    try {
      const sessionHistory = new SessionHistoryService(this.env.DB);
      await sessionHistory.updateLastMessageAt(sessionId);

      // Check if this is the first user message — if so, generate a title via LLM
      // TODO: STORE MESSAGES IN MEMORY?
      const userMessages = this.messageRepository.getAllBySession(
        sessionId,
      ).filter((m) => m.message.role === "user");

      if (userMessages.length === 1) {
        const title = await generateSessionTitle(
          this.env.ANTHROPIC_API_KEY,
          content,
        );
        this.logger.info(`Generated session title: ${title} for session ${sessionId}`, {
          loggerName,
        });
        await sessionHistory.updateTitle(sessionId, title);
      }
    } catch (error) {
      this.logger.error("Failed to sync message to D1 history", {
        loggerName,
        error,
      });
    }
  }

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
          { loggerName },
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

    return {
      id,
      role: "user",
      parts: messageParts,
    };
  }

  private getUserMessageTextContent(message: UIMessage | null): string | undefined {
    if (!message) {
      return undefined;
    }

    const text = message.parts
      .flatMap((part) => (
        part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
          ? [String(part.text)]
          : []
      ))
      .join("")
      .trim();

    return text || undefined;
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

  private broadcastMessage(message: ServerMessage, without?: string[]): void {
    this.broadcast(JSON.stringify(message), without);
  }

  private sendMessage(message: ServerMessage, to: Connection) : void {
    to.send(JSON.stringify(message));
  }
}
