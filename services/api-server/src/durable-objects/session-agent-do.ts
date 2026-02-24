import {
  SpritesCoordinator,
  WorkersSprite,
  SpriteWebsocketSession,
  SpriteServerMessage,
} from "@/lib/sprites";
import {
  type SessionSettings,
  type ClientMessage,
  type ServerMessage,
  type AgentOutput,
  decodeAgentOutput,
  encodeAgentInput,
  // Session,
  SessionInfoResponse,
  SessionStatus,
} from "@repo/shared";
import type { Env } from "@/types";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";
import { Agent, type Connection } from "agents";
import { MessageRepository } from "./repositories/message-repository";
import { SecretRepository } from "./repositories/secret-repository";
import { SchemaManager } from "./repositories/schema-manager";

import { buildNetworkPolicy } from "@/lib/sprites/network-policy";
import { MessageAccumulator } from "@/lib/message-accumulator";
import {
  handleGitProxy,
  ensureValidToken,
  type GitProxyContext,
} from "@/lib/git-proxy";
import { GitHubAppService } from "@/lib/github/github-app";
import { SessionHistoryService } from "@/lib/session-history";
import { generateSessionTitle } from "@/lib/generate-session-title";
import type { UIMessage } from "ai";

const WORKSPACE_DIR = "/home/sprite/workspace";
const HOME_DIR = "/home/sprite";

/** Session metadata stored in Agent state (survives hibernation)
 * IMPORTANT: THIS STATE IS PROPAGATED TO CLIENTS. DO NOT PUT SENSITIVE DATA HERE.
 */
type AgentState = {
  sessionId: string | null;
  userId: string | null;
  repoFullName: string | null;
  spriteName: string | null;
  /** Session ID given by the Claude Agent SDK */
  claudeSessionId: string | null;
  /** ID of the agent process session running on the sprite */
  agentProcessId: number | null;
  status: SessionStatus;
  settings: SessionSettings;
  /** Branch name locked after first push (for "Create PR" flow) */
  pushedBranch: string | null;
  /** GitHub PR URL after creation */
  pullRequestUrl: string | null;
  /** GitHub PR number for API lookups */
  pullRequestNumber: number | null;
  /** PR state: open, merged, or closed */
  pullRequestState: "open" | "merged" | "closed" | null;
  createdAt: Date;
};

interface InitRequest {
  sessionId: string;
  repoFullName: string;
  settings?: Partial<SessionSettings>;
}

export class SessionAgentDO extends Agent<Env, AgentState> {
  private spritesCoordinator: SpritesCoordinator | null = null;
  private messageRepository: MessageRepository | null = null;
  private secretRepository: SecretRepository | null = null;
  /** vm-agent session running on the sprite */
  private agentSession: SpriteWebsocketSession | null = null;
  /** mitmproxy session for HTTP debugging */
  private mitmSession: SpriteWebsocketSession | null = null;
  /** Mutex for reattachment to prevent race conditions */
  private reattachPromise: Promise<void> | null = null;
  /** Accumulator for building UIMessage from stream chunks */
  private messageAccumulator: MessageAccumulator = new MessageAccumulator();
  /** GitHub App installation access token (in-memory cache, persisted in SQLite) */
  private githubToken: string | null = null;
  /** Random nonce for git proxy auth (in-memory cache, persisted in SQLite secrets) */
  private gitProxySecret: string | null = null;

  initialState: AgentState = {
    sessionId: "",
    userId: "",
    repoFullName: "",
    spriteName: null,
    claudeSessionId: null,
    agentProcessId: null,
    status: "provisioning",
    settings: { model: "claude-opus-4-20250514", maxTokens: 8192 },
    pushedBranch: null,
    pullRequestUrl: null,
    pullRequestNumber: null,
    pullRequestState: null,
    createdAt: new Date(),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initializeSchema();
    this.initializeClients();
  }

  private initializeSchema(): void {
    const sql = this.sql.bind(this);
    this.messageRepository = new MessageRepository(sql);
    this.secretRepository = new SecretRepository(sql);

    new SchemaManager([
      this.messageRepository,
      this.secretRepository,
    ]).migrate();

    // Load secrets from SQLite into memory
    this.githubToken = this.secretRepository.get("github_token");
    this.gitProxySecret = this.secretRepository.get("git_proxy_secret");
  }

  private initializeClients(): void {
    this.spritesCoordinator = new SpritesCoordinator({
      apiKey: this.env.SPRITES_API_KEY,
    });
    if (!this.messageRepository) {
      this.messageRepository = new MessageRepository(this.sql.bind(this));
    }
    if (!this.secretRepository) {
      this.secretRepository = new SecretRepository(this.sql.bind(this));
    }
  }

  // Ensure clients are initialized (may be null after hibernation)
  private ensureClients(): void {
    if (!this.spritesCoordinator) {
      this.initializeClients();
    }
  }

  private updateStatus(status: SessionStatus): void {
    this.setState({ ...this.state, status });
  }

  // ============================================
  // HTTP Handlers
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    console.debug(`[HTTP request] ${request.method} ${url.pathname}`);
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
        this.setState({ ...this.state, pushedBranch: result.pushedBranch });
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

    // Pass unhandled requests to Agent SDK (WebSocket upgrades, internal setup routes, etc.)
    return super.fetch(request);
  }

  // Called by Agent SDK when a new WebSocket connection is established
  onConnect(connection: Connection): void {
    console.debug(`client connected: ${connection.id}`);
    // Send initial connection state
    connection.send(
      JSON.stringify({
        type: "connected",
        sessionId: this.state?.sessionId ?? "",
        status: this.state?.status ?? "unknown",
      } satisfies ServerMessage),
    );

    // Send message history
    if (this.state?.sessionId && this.messageRepository) {
      this.ensureClients();
      const storedMessages = this.messageRepository!.getAllBySession(
        this.state.sessionId,
      );
      connection.send(
        JSON.stringify({
          type: "sync.response",
          messages: storedMessages.map((m) => m.message),
        } satisfies ServerMessage),
      );
    }

    // Proactively trigger reattachment when client connects (non-blocking)
    if (
      this.state.status === "ready" &&
      !this.agentSession &&
      this.state.spriteName
    ) {
      this.ctx.waitUntil(this.reattachAgentSession(this.state.spriteName));
    } else {
      console.debug(
        `reattachAgentSession not triggered: status=${this.state.status}, spriteName=${this.state.spriteName}`,
      );
    }
  }

  // Agent SDK WebSocket handlers
  async onMessage(
    connection: Connection,
    message: string | ArrayBuffer,
  ): Promise<void> {
    this.ensureClients();

    try {
      const messageStr =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);
      const data = JSON.parse(messageStr) as ClientMessage;
      await this.handleClientMessage(connection, data);
    } catch (error) {
      console.error("Failed to handle message:", error);
      connection.send(
        JSON.stringify({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Failed to parse message",
        } satisfies ServerMessage),
      );
    }
  }

  onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void {
    // Cleanup if needed
    console.log(
      `WebSocket closed: code=${code}, reason=${reason}, wasClean=${wasClean}`,
    );
  }

  onError(connectionOrError: Connection | unknown, error?: unknown): void {
    console.error("WebSocket error:", error ?? connectionOrError);
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

    const settings: SessionSettings = {
      model: data.settings?.model ?? "claude-opus-4-20250514",
      maxTokens: data.settings?.maxTokens ?? 8192,
    };

    // Generate git proxy secret and persist in SQLite (not in state — state is sent to clients)
    this.gitProxySecret = crypto.randomUUID();
    this.secretRepository!.set("git_proxy_secret", this.gitProxySecret);

    // Initialize agent state
    this.setState({
      ...this.state,
      sessionId: data.sessionId,
      repoFullName: data.repoFullName,
      spriteName: null,
      claudeSessionId: null,
      agentProcessId: null,
      status: "provisioning",
      settings,
    });

    // Provision sprite asynchronously
    this.ctx.waitUntil(this.provisionSprite(data.sessionId, data.repoFullName));

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async provisionSprite(
    sessionId: string,
    repoFullName: string,
  ): Promise<void> {
    console.debug(
      `Provisioning sprite for session ${sessionId} and repo ${repoFullName}`,
    );
    this.getConnections();
    try {
      this.ensureClients();

      if (!this.gitProxySecret) {
        // this should never happen, but just in case
        throw new Error(
          "gitProxySecret is not set — cannot provision sprite without it",
        );
      }

      const spriteResponse = await this.spritesCoordinator!.createSprite({
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

      // Build proxy clone URL — token never enters the sprite
      const proxyBaseUrl = `${this.env.WORKER_URL}/git-proxy/${sessionId}`;
      const cloneUrl = `${proxyBaseUrl}/github.com/${repoFullName}.git`;

      // Clone the repo
      // check if the repo is already cloned
      const isCloned = await sprite.execHttp(
        `test -d ${WORKSPACE_DIR}/.git && echo 'exists' || echo 'empty'`,
        {},
      );
      if (isCloned.stdout.includes("exists")) {
        console.log(
          `Repo ${repoFullName} already cloned on sprite ${spriteResponse.name}`,
        );
      } else {
        this.setState({
          ...this.state,
          spriteName: spriteResponse.name,
          status: "cloning",
        });

        // NOTE: even though the git command is not controlled by the agent, we still use the proxy url
        // to prevent the token from being visible to the vm (and to the agent)
        this.broadcastMessage({
          type: "session.status",
          status: "cloning",
          message: `Cloning repo ${repoFullName} on sprite ${spriteResponse.name}`,
        });
        console.log(
          `Cloning repo ${repoFullName} on sprite ${spriteResponse.name}`,
        );
        await sprite.execHttp(`mkdir -p ${WORKSPACE_DIR}`, {});

        // Fetch a read-only token scoped to contents:read for the initial clone
        const github = new GitHubAppService(this.env);
        const cloneToken = await github.getReadOnlyTokenForRepo(repoFullName);
        const basicAuth = btoa(`x-access-token:${cloneToken}`);

        // Also refresh the write token for the proxy (used after clone)
        await this.refreshGitHubToken();
        const cloneStart = Date.now();
        const cloneResult = await sprite.execHttp(
          `git -c http.extraHeader="Authorization: Basic ${basicAuth}" clone https://github.com/${repoFullName}.git ${WORKSPACE_DIR}`,
          {},
        );
        console.log(
          `Clone completed in ${((Date.now() - cloneStart) / 1000).toFixed(1)}s: exitCode=${cloneResult.exitCode}, stderr=${cloneResult.stderr.slice(0, 500)}`,
        );
        if (cloneResult.exitCode !== 0) {
          throw new Error(
            `Clone failed (exit ${cloneResult.exitCode}): ${cloneResult.stderr}`,
          );
        }

        // Point remote at the proxy for subsequent push/fetch
        await sprite.execHttp(
          `cd ${WORKSPACE_DIR} && git remote set-url origin ${cloneUrl}`,
          {},
        );
      }

      // Set up git config for commits
      await sprite.execHttp(
        `cd ${WORKSPACE_DIR} && git config user.email "cloude@cloude.dev" && git config user.name "Cloude Code"`,
        {},
      );

      // Configure git to send the proxy auth header on all requests to the proxy
      await sprite.execHttp(
        `cd ${WORKSPACE_DIR} && git config http.extraHeader "Authorization: Bearer ${this.gitProxySecret}"`,
        {},
      );

      // this.updateStatus("attaching");
      // this.broadcastMessage({ type: "session.status", status: "attaching" });
      // Start mitmproxy as a session, then vm-agent
      // await this.startMitmproxyOnVM(sprite);
      await this.startAgentOnVM(spriteResponse.name);

      this.updateStatus("ready");
      this.broadcastMessage({ type: "session.status", status: "ready" });
    } catch (error) {
      console.error("Failed to provision sprite:", error);
      this.updateStatus("error");
      this.broadcastMessage({
        type: "session.status",
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private async startMitmproxyOnVM(sprite: WorkersSprite): Promise<void> {
    console.debug(`Starting mitmproxy on sprite ${sprite.name}`);
    // Install mitmproxy for HTTP header debugging
    await sprite.execHttp(`pip install mitmproxy`, {});

    // Kill any existing mitmproxy to free port 8080
    await sprite.execHttp(`pkill -f mitmdump || true`, {});
    await new Promise((r) => setTimeout(r, 200));

    const PYENV_SHIMS = "/.sprite/languages/python/pyenv/shims";
    this.mitmSession = sprite.createSession(
      `${PYENV_SHIMS}/mitmdump`,
      [
        "-p",
        "8080",
        "--set",
        "stream_large_bodies=1",
        "-w",
        `${HOME_DIR}/.cloude/traffic.mitm`,
      ],
      {},
    );

    // Only log errors, traffic is written to file
    this.mitmSession.onStderr((data) => console.log("[mitmdump err]", data));

    await this.mitmSession.start();
    // Give it a moment to bind to port
    await new Promise((r) => setTimeout(r, 500));
    console.log(`mitmproxy started on sprite ${sprite.name}`);
  }

  private async startAgentOnVM(spriteName: string): Promise<void> {
    const sprite = new WorkersSprite(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    await sprite.writeFile(`${HOME_DIR}/.cloude/agent.js`, VM_AGENT_SCRIPT);
    const claudeSessionId = this.state.claudeSessionId;
    const commands = [
      "bun",
      "run",
      `${HOME_DIR}/.cloude/agent.js`,
      ...(claudeSessionId ? [`--sessionId=${claudeSessionId}`] : []),
    ];
    this.agentSession = sprite.createSession("env", commands, {
      cwd: WORKSPACE_DIR,
      tty: false,
      env: {
        ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY,
        SESSION_ID: this.state.sessionId ?? "",
        // Proxy disabled for now - uncomment to debug HTTP traffic
        // HTTP_PROXY: "http://127.0.0.1:8080",
        // HTTPS_PROXY: "http://127.0.0.1:8080",
        // http_proxy: "http://127.0.0.1:8080",
        // https_proxy: "http://127.0.0.1:8080",
        // ALL_PROXY: "http://127.0.0.1:8080",
        // NODE_TLS_REJECT_UNAUTHORIZED: "0",
        // NODE_EXTRA_CA_CERTS: `${HOME_DIR}/.mitmproxy/mitmproxy-ca-cert.pem`,
      },
    });

    this.setupAgentSessionHandlers();
    await this.agentSession.start();
    console.log(`vm-agent started on sprite ${spriteName}`);
  }

  private setupAgentSessionHandlers(): void {
    if (!this.agentSession) return;

    this.agentSession.onStdout((data: string) => {
      this.handleAgentStdout(data);
    });

    this.agentSession.onStderr((data: string) => {
      console.error(`vm-agent stderr: ${data}`);
    });

    this.agentSession.onExit((code: number) => {
      console.log(`vm-agent exited with code ${code}`);
      this.agentSession = null;
    });

    this.agentSession.onServerMessage((msg: SpriteServerMessage) => {
      this.handleAgentServerMessage(msg);
    });
  }

  private handleAgentStdout(data: string): void {
    console.log(`[vm-agent stdout] ${data}`);

    for (const line of data.split("\n")) {
      if (!line.trim()) continue;

      try {
        const output = decodeAgentOutput(line);
        this.handleAgentOutput(output);
      } catch {
        // Ignore lines that don't match AgentOutput schema (e.g., TTY echo)
        console.debug(`Skipping invalid agent output: ${line}`);
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
        console.error(`vm-agent error: ${output.error}`);
        this.broadcastMessage({
          type: "error",
          code: "AGENT_ERROR",
          message: output.error,
        });
        break;
      }
      case "debug": {
        console.debug(`[vm-agent debug] ${output.message}`);
        break;
      }
      case "stream": {
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

          // Reset accumulator for next message
          this.messageAccumulator.reset();
        }
        break;
      }
      case "sessionId": {
        // Store Claude's session ID for resuming later
        console.log(`Storing Claude session ID: ${output.sessionId}`);
        this.setState({ ...this.state, claudeSessionId: output.sessionId });
        break;
      }
    }
  }

  private handleAgentServerMessage(msg: SpriteServerMessage): void {
    switch (msg.type) {
      case "session_info":
        console.log(`vm-agent session id: ${JSON.stringify(msg.session_id)}`);
        this.setState({ ...this.state, agentProcessId: msg.session_id });
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
      secretRepository: this.secretRepository!,
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
        pushedBranch: this.state.pushedBranch ?? undefined,
        pullRequestUrl: this.state.pullRequestUrl ?? undefined,
        pullRequestNumber: this.state.pullRequestNumber ?? undefined,
        pullRequestState: this.state.pullRequestState ?? undefined,
      } satisfies SessionInfoResponse),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  private handleGetMessages(): Response {
    this.ensureClients();

    if (!this.state.sessionId) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const storedMessages = this.messageRepository!.getAllBySession(
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
    this.setState({
      ...this.state,
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
    this.setState({
      ...this.state,
      pullRequestState: data.state,
    });
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleDeleteSession(): Promise<Response> {
    this.ensureClients();

    // Clean up sprite
    if (this.state.spriteName && this.spritesCoordinator) {
      try {
        await this.spritesCoordinator.deleteSprite(this.state.spriteName);
      } catch (error) {
        console.error("Failed to delete sprite:", error);
      }
    }

    // Clear messages
    if (this.state.sessionId) {
      const sessionId = this.state.sessionId;
      this.sql`DELETE FROM messages WHERE session_id = ${sessionId}`;
    }

    // Reset state
    this.setState({
      ...this.state,
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
        await this.handleChatMessage(connection, message.content);
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
    content: string,
  ): Promise<void> {
    switch (this.state.status) {
      case "provisioning":
      case "cloning":
      case "syncing":
      case "attaching":
        connection.send(
          JSON.stringify({
            type: "error",
            code: "SESSION_TRANSITIONING",
            message: `Session is ${this.state.status}, please wait`,
          } satisfies ServerMessage),
        );
        return;
      case "waking":
        connection.send(
          JSON.stringify({
            type: "error",
            code: "SESSION_TRANSITIONING",
            message: `Session is ${this.state.status}, please wait`,
          } satisfies ServerMessage),
        );
        return;
      case "hibernating":
      case "error":
      case "terminated":
        connection.send(
          JSON.stringify({
            type: "error",
            code: "SESSION_NOT_READY",
            message: `Session is ${this.state.status}`,
          } satisfies ServerMessage),
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
    if (!this.agentSession && this.state.spriteName) {
      await this.reattachAgentSession(this.state.spriteName);
    }

    if (!this.agentSession) {
      connection.send(
        JSON.stringify({
          type: "error",
          code: "NO_AGENT_SESSION",
          message: "Agent session not available",
        } satisfies ServerMessage),
      );
      return;
    }

    // Store user message with parts format
    this.ensureClients();
    if (!this.state.sessionId) {
      console.error("No session id");
      return;
    }
    // We also need to broadcast this to all clients who are not this connected client.
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: content }],
    };
    const stored = this.messageRepository!.create(
      this.state.sessionId,
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
    this.ctx.waitUntil(this.syncMessageToHistory(content));

    // Send to vm-agent
    console.log(`Sending to vm-agent: ${content}`);
    this.agentSession.write(encodeAgentInput({ type: "chat", content }) + "\n");
  }

  private async syncRepository(sprite: WorkersSprite): Promise<void> {
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
    this.ensureClients();

    const sprite = new WorkersSprite(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL,
    );

    // Restart mitmproxy if not running (it doesn't survive hibernation)
    if (!this.mitmSession) {
      await this.startMitmproxyOnVM(sprite);
    }

    // Refresh GitHub token before sync (may have expired during hibernation)
    try {
      await this.refreshGitHubToken();
    } catch (error) {
      console.error("Failed to refresh GitHub token:", error);
    }

    // Sync repository before reattaching
    this.updateStatus("syncing");
    this.broadcastMessage({ type: "session.status", status: "syncing" });
    await this.syncRepository(sprite);

    // Set status to attaching
    this.updateStatus("attaching");
    this.broadcastMessage({ type: "session.status", status: "attaching" });
    const sessions = await this.spritesCoordinator!.listSessions(spriteName);
    const existingSession = sessions.find(
      (s) => s.id === String(this.state?.agentProcessId),
    );

    // Check if other clients are connected (current client is already counted)
    const connectionCount = [...this.getConnections()].length;
    const otherClientsConnected = connectionCount > 1;

    if (existingSession && otherClientsConnected) {
      // Multiplayer: attach to existing session to not disrupt others
      console.log(
        `${connectionCount} clients connected and vm-agent session exists, attaching to existing session ${existingSession.id}`,
      );
      this.agentSession = sprite.attachSession(String(existingSession.id), {});
      this.setupAgentSessionHandlers();
      await this.agentSession.start();
    } else {
      // Solo: start fresh with latest script (old session orphaned)
      console.log(`No other clients connected, starting fresh vm-agent`);
      await this.startAgentOnVM(spriteName);
    }

    // Set status back to ready
    this.updateStatus("ready");
    this.broadcastMessage({ type: "session.status", status: "ready" });
  }

  /**
   * Handles a client request to sync message history.
   * @param connection The connection to the client.
   */
  private handleSyncRequest(connection: Connection): void {
    this.ensureClients();

    if (!this.state?.sessionId) {
      connection.send(
        JSON.stringify({
          type: "sync.response",
          messages: [],
        }),
      );
      return;
    }

    const storedMessages = this.messageRepository!.getAllBySession(
      this.state.sessionId,
    );
    connection.send(
      JSON.stringify({
        type: "sync.response",
        messages: storedMessages.map((m) => m.message),
      }),
    );
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
      const userMessages = this.messageRepository!.getAllBySession(
        sessionId,
      ).filter((m) => m.message.role === "user");

      if (userMessages.length === 1) {
        const title = await generateSessionTitle(
          this.env.ANTHROPIC_API_KEY,
          content,
        );
        await sessionHistory.updateTitle(sessionId, title);
      }
    } catch (error) {
      console.error("Failed to sync message to D1 history:", error);
    }
  }

  private broadcastMessage(message: ServerMessage, without?: string[]): void {
    this.broadcast(JSON.stringify(message), without);
  }
}
