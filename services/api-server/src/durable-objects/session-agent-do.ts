import { SpritesCoordinator, WorkersSprite, SpriteWebsocketSession, SpriteServerMessage } from "@/lib/sprites";
import {
  type SessionSettings,
  type ClientMessage,
  type ServerMessage,
  type AgentOutput,
  decodeAgentOutput,
  encodeAgentInput,
  Session,
  SessionInfoResponse,
  SessionStatus,
} from "@repo/shared";
import type { Env } from "@/types";
import { GitHubAppService } from "@/lib/github";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";
import { Agent, type Connection } from "agents";
import { MessageRepository } from "./repositories/message-repository";
import { generateBranchSlug } from "@/lib/branch-slug";
import { MessageAccumulator } from "@/lib/message-accumulator";
import type { UIMessage } from "ai";

const WORKSPACE_DIR = "/home/sprite/workspace";
const HOME_DIR = "/home/sprite";

// Session metadata stored in Agent state (survives hibernation)
type AgentState = {
  sessionId: string | null;
  userId: string | null;
  repoId: string | null;
  spriteName: string | null;
  githubBranchName: string | null;
  /** Session ID given by the Claude Agent SDK */
  claudeSessionId: string | null;
  /** ID of the agent process session running on the sprite */
  agentProcessId: number | null;
  status: SessionStatus;
  settings: SessionSettings;
  createdAt: Date;
};

interface InitRequest {
  sessionId: string;
  repoId: string;
  settings?: Partial<SessionSettings>;
}

export class SessionAgentDO extends Agent<Env, AgentState> {
  private spritesCoordinator: SpritesCoordinator | null = null;
  private messageRepository: MessageRepository | null = null;
  /** Buffer for partial NDJSON lines from agent stdout */
  private agentOutputBuffer: string = "";
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
    repoId: "",
    spriteName: null,
    githubBranchName: null,
    claudeSessionId: null,
    agentProcessId: null,
    status: "provisioning",
    settings: { model: "claude-opus-4-20250514", maxTokens: 8192 },
    createdAt: new Date(),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initializeSchema();
    this.initializeClients();
  }

  private initializeSchema(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `;
    this.sql`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)`;
    this.sql`
      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;
    // Load secrets from SQLite into memory
    const rows = [...this.sql`SELECT key, value FROM secrets WHERE key IN ('github_token', 'git_proxy_secret')`];
    for (const row of rows) {
      const { key, value } = row as { key: string; value: string };
      if (key === "github_token") this.githubToken = value;
      if (key === "git_proxy_secret") this.gitProxySecret = value;
    }
  }

  private initializeClients(): void {
    this.spritesCoordinator = new SpritesCoordinator({
      apiKey: this.env.SPRITES_API_KEY,
    });
    this.messageRepository = new MessageRepository(this.sql.bind(this));
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
      return this.handleGitProxy(request, path);
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
    connection.send(JSON.stringify({
      type: "connected",
      sessionId: this.state?.sessionId ?? "",
      status: this.state?.status ?? "unknown",
    } satisfies ServerMessage));

    // Send message history
    if (this.state?.sessionId && this.messageRepository) {
      this.ensureClients();
      const storedMessages = this.messageRepository!.getAllBySession(this.state.sessionId);
      connection.send(JSON.stringify({
        type: "sync.response",
        messages: storedMessages.map((m) => m.message),
      } satisfies ServerMessage));
    }

    // Proactively trigger reattachment when client connects (non-blocking)
    if (this.state.status === "ready" && !this.agentSession && this.state.spriteName) {
      this.ctx.waitUntil(this.reattachAgentSession(this.state.spriteName));
    } else {
      console.debug(`reattachAgentSession not triggered: status=${this.state.status}, spriteName=${this.state.spriteName}`);
    }
  }

  // Agent SDK WebSocket handlers
  async onMessage(connection: Connection, message: string | ArrayBuffer): Promise<void> {
    this.ensureClients();

    try {
      const messageStr = typeof message === "string" ? message : new TextDecoder().decode(message);
      const data = JSON.parse(messageStr) as ClientMessage;
      await this.handleClientMessage(connection, data);
    } catch (error) {
      console.error("Failed to handle message:", error);
      connection.send(JSON.stringify({
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Failed to parse message",
      } satisfies ServerMessage));
    }
  }

  onClose(connection: Connection, code: number, reason: string, wasClean: boolean): void {
    // Cleanup if needed
    console.log(`WebSocket closed: code=${code}, reason=${reason}, wasClean=${wasClean}`);
  }

  onError(connectionOrError: Connection | unknown, error?: unknown): void {
    console.error("WebSocket error:", error ?? connectionOrError);
  }

  private async handleInit(request: Request): Promise<Response> {
    // Prevent re-initialization
    if (this.state.sessionId) {
      return new Response(JSON.stringify({ error: "Session already initialized" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = (await request.json()) as InitRequest;

    const settings: SessionSettings = {
      model: data.settings?.model ?? "claude-opus-4-20250514",
      maxTokens: data.settings?.maxTokens ?? 8192,
    };

    // Generate git proxy secret and persist in SQLite (not in state — state is sent to clients)
    this.gitProxySecret = crypto.randomUUID();
    this.sql`INSERT OR REPLACE INTO secrets (key, value) VALUES ('git_proxy_secret', ${this.gitProxySecret})`;

    // Initialize agent state
    this.setState({
      ...this.state,
      sessionId: data.sessionId,
      userId: "anonymous", // todo
      repoId: data.repoId,
      spriteName: null,
      githubBranchName: null,
      claudeSessionId: null,
      agentProcessId: null,
      status: "provisioning",
      settings,
    });

    // Provision sprite asynchronously
    this.ctx.waitUntil(this.provisionSprite(data.sessionId, data.repoId));

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async provisionSprite(sessionId: string, repoId: string): Promise<void> {
    console.debug(`Provisioning sprite for session ${sessionId} and repo ${repoId}`);
    this.getConnections()
    try {
      this.ensureClients();

      const spriteResponse = await this.spritesCoordinator!.createSprite({
        name: `${sessionId}`,
        env: {},
      });

      const sprite = new WorkersSprite(
        spriteResponse.name,
        this.env.SPRITES_API_KEY,
        this.env.SPRITES_API_URL
      );

      // Build proxy clone URL — token never enters the sprite
      const proxyBaseUrl = `${this.env.WORKER_URL}/git-proxy/${sessionId}`;
      const cloneUrl = `${proxyBaseUrl}/github.com/${repoId}.git`;

      // Clone the repo
      // check if the repo is already cloned
      const isCloned = await sprite.execHttp(`test -d ${WORKSPACE_DIR}/.git && echo 'exists' || echo 'empty'`, {});
      if (isCloned.stdout.includes("exists")) {
        console.log(`Repo ${repoId} already cloned on sprite ${spriteResponse.name}`);
      } else {
        this.setState({
          ...this.state,
          spriteName: spriteResponse.name,
          status: "cloning",
        });

        this.broadcastMessage({
          type: "session.status",
          status: "cloning",
          message: `Cloning repo ${repoId} on sprite ${spriteResponse.name}`,
        });
        console.log(`Cloning repo ${repoId} on sprite ${spriteResponse.name}`);
        await sprite.execHttp(`mkdir -p ${WORKSPACE_DIR}`, {});

        // Fetch a token for the initial clone (ensureValidToken won't work until first proxy request)
        await this.ensureValidToken();

        const cloneResult = await sprite.execHttp(
          `git -c http.extraHeader="Authorization: Bearer ${this.gitProxySecret}" clone ${cloneUrl} ${WORKSPACE_DIR}`,
          {}
        );
        console.log(`Clone result: exitCode=${cloneResult.exitCode}`);
        // Verify clone
        const verifyResult = await sprite.execHttp(`ls -la ${WORKSPACE_DIR}`, {});
        if (!verifyResult.stdout || verifyResult.stdout.trim().split("\n").length < 3) {
          throw new Error(`Clone failed - workspace empty: ${cloneResult.stderr}`);
        }
      }

      // Set up git config for commits
      await sprite.execHttp(`cd ${WORKSPACE_DIR} && git config user.email "cloude@cloude.dev"`, {});
      await sprite.execHttp(`cd ${WORKSPACE_DIR} && git config user.name "Cloude Agent"`, {});

      // Configure git to send the proxy auth header on all requests to the proxy
      await sprite.execHttp(
        `cd ${WORKSPACE_DIR} && git config http.extraHeader "Authorization: Bearer ${this.gitProxySecret}"`,
        {}
      );

      // Install mitmproxy for HTTP header debugging
      await sprite.execHttp(`pip install mitmproxy`, {});

      // Start mitmproxy as a session, then vm-agent
      await this.startMitmproxyOnVM(spriteResponse.name);
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

  private async startMitmproxyOnVM(spriteName: string): Promise<void> {
    console.debug(`Starting mitmproxy on sprite ${spriteName}`);
    const sprite = new WorkersSprite(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL
    );

    // Kill any existing mitmproxy to free port 8080
    await sprite.execHttp(`pkill -f mitmdump || true`, {});
    await new Promise(r => setTimeout(r, 200));

    const PYENV_SHIMS = "/.sprite/languages/python/pyenv/shims";
    this.mitmSession = sprite.createSession(
      `${PYENV_SHIMS}/mitmdump`,
      ["-p", "8080", "--set", "stream_large_bodies=1", "-w", `${HOME_DIR}/.cloude/traffic.mitm`],
      {}
    );

    // Only log errors, traffic is written to file
    this.mitmSession.onStderr((data) => console.log("[mitmdump err]", data));

    await this.mitmSession.start();
    // Give it a moment to bind to port
    await new Promise(r => setTimeout(r, 500));
    console.log(`mitmproxy started on sprite ${spriteName}`);
  }

  private async startAgentOnVM(spriteName: string): Promise<void> {
    const sprite = new WorkersSprite(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL
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
        // Proxy disabled for now - uncomment to debug HTTP traffic
        // HTTP_PROXY: "http://127.0.0.1:8080",
        // HTTPS_PROXY: "http://127.0.0.1:8080",
        // http_proxy: "http://127.0.0.1:8080",
        // https_proxy: "http://127.0.0.1:8080",
        // ALL_PROXY: "http://127.0.0.1:8080",
        // NODE_TLS_REJECT_UNAUTHORIZED: "0",
        // NODE_EXTRA_CA_CERTS: `${HOME_DIR}/.mitmproxy/mitmproxy-ca-cert.pem`,
      }
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
    this.agentOutputBuffer += data;
    const lines = this.agentOutputBuffer.split("\n");
    this.agentOutputBuffer = lines.pop() ?? "";

    for (const line of lines) {
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
            const stored = this.messageRepository.create(this.state.sessionId, message);

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

  // ============================================
  // Git Proxy
  // ============================================

  private async handleGitProxy(request: Request, path: string): Promise<Response> {
    // Authenticate: check Bearer token matches session secret
    const authHeader = request.headers.get("Authorization");
    if (!this.gitProxySecret || authHeader !== `Bearer ${this.gitProxySecret}`) {
      return new Response("unauthorized", { status: 401 });
    }

    // Strip the /git-proxy/<sessionId>/ prefix to get github.com/owner/repo.git/...
    const match = path.match(/^\/git-proxy\/[^/]+\/github\.com\/(.+)/);
    if (!match?.[1]) return new Response("invalid path", { status: 400 });
    const githubPath = match[1];

    // Enforce: only the configured repo (match with .git suffix to prevent prefix collisions like acme/app matching acme/app-evil)
    if (this.state.repoId && !githubPath.startsWith(`${this.state.repoId}.git`)) {
      return new Response("repo not allowed", { status: 403 });
    }

    // Enforce: push only to session branch
    if (githubPath.endsWith("/git-receive-pack") && request.method === "POST") {
      const body = await request.arrayBuffer();
      const pushCheck = this.validatePush(new Uint8Array(body));
      if (!pushCheck.allowed) {
        return new Response(`push rejected: ${pushCheck.reason}`, { status: 403 });
      }
      return this.forwardToGitHub(githubPath, request, body);
    }

    // Read operations (clone, fetch, pull) — always forward
    return this.forwardToGitHub(githubPath, request, request.body);
  }

  private async forwardToGitHub(
    githubPath: string,
    originalRequest: Request,
    body: ArrayBuffer | ReadableStream<Uint8Array> | null,
  ): Promise<Response> {
    await this.ensureValidToken();

    const url = new URL(originalRequest.url);
    const targetUrl = `https://github.com/${githubPath}${url.search}`;

    const headers: Record<string, string> = {
      "Authorization": `token ${this.githubToken}`,
      "User-Agent": "cloude-code-git-proxy",
    };

    const contentType = originalRequest.headers.get("Content-Type");
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    return fetch(targetUrl, {
      method: originalRequest.method,
      headers,
      body,
    });
  }

  private validatePush(body: Uint8Array): { allowed: boolean; reason?: string } {
    const allowedBranch = this.state.githubBranchName;
    if (!allowedBranch) return { allowed: true };

    // Git pkt-line format: "oldsha newsha refs/heads/branch\0capabilities..."
    const preamble = new TextDecoder().decode(body.slice(0, 2048));
    const refPattern = /[0-9a-f]{40} [0-9a-f]{40} refs\/heads\/(\S+)/g;
    let match;
    while ((match = refPattern.exec(preamble)) !== null) {
      if (match[1] !== allowedBranch) {
        return { allowed: false, reason: `only '${allowedBranch}' allowed, got '${match[1]}'` };
      }
    }
    return { allowed: true };
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.state.repoId) return;

    // GitHubAppService handles caching with a 5-minute buffer before expiry
    const github = new GitHubAppService(this.env);
    const token = await github.getTokenForRepo(this.state.repoId);
    this.githubToken = token;
    this.sql`INSERT OR REPLACE INTO secrets (key, value) VALUES ('github_token', ${token})`;
  }

  private handleGetSession(): Response {
    if (!this.state.sessionId || !this.state.repoId) {
      return new Response("Session not found", { status: 404 });
    }

    return new Response(JSON.stringify({
      sessionId: this.state.sessionId,
      status: this.state.status,
      repoId: this.state.repoId,
    } satisfies SessionInfoResponse), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleGetMessages(): Response {
    this.ensureClients();

    if (!this.state.sessionId) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const storedMessages = this.messageRepository!.getAllBySession(this.state.sessionId);
    return new Response(JSON.stringify(storedMessages.map((m) => m.message)), {
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

  private async handleClientMessage(connection: Connection, message: ClientMessage): Promise<void> {
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

  private async handleChatMessage(connection: Connection, content: string): Promise<void> {
    switch (this.state.status) {
      case "provisioning":
      case "cloning":
      case "syncing":
      case "attaching":
        connection.send(JSON.stringify({
          type: "error",
          code: "SESSION_TRANSITIONING",
          message: `Session is ${this.state.status}, please wait`,
        } satisfies ServerMessage));
        return;
      case "waking":
        connection.send(JSON.stringify({
          type: "error",
          code: "SESSION_TRANSITIONING",
          message: `Session is ${this.state.status}, please wait`,
        } satisfies ServerMessage));
        return;
      case "hibernating":
      case "error":
      case "terminated":
        connection.send(JSON.stringify({
          type: "error",
          code: "SESSION_NOT_READY",
          message: `Session is ${this.state.status}`,
        } satisfies ServerMessage));
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
      connection.send(JSON.stringify({
        type: "error",
        code: "NO_AGENT_SESSION",
        message: "Agent session not available",
      } satisfies ServerMessage));
      return;
    }

    // Create feature branch on first message
    if (!this.state.githubBranchName && this.state.spriteName) {
      try {
        const branchSlug = await generateBranchSlug(content, this.env.ANTHROPIC_API_KEY);
        console.log(`Generated branch slug: ${branchSlug}`);
        await this.createFeatureBranch(this.state.spriteName, branchSlug);
        this.setState({ ...this.state, githubBranchName: branchSlug });
        console.log(`Created feature branch: ${branchSlug}`);
      } catch (error) {
        console.error("Failed to create feature branch:", error);
        connection.send(JSON.stringify({
          type: "error",
          code: "FAILED_TO_CREATE_BRANCH",
          message: "Failed to create feature branch",
        } satisfies ServerMessage));
        return;
      }
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
    const stored = this.messageRepository!.create(this.state.sessionId, userMessage);
    this.broadcastMessage({
      type: "user.message",
      message: stored.message,
    }, [connection.id]);

    // Send to vm-agent
    console.log(`Sending to vm-agent: ${content}`);
    this.agentSession.write(encodeAgentInput({ type: "chat", content }) + "\n");
  }

  private async createFeatureBranch(spriteName: string, branchName: string): Promise<void> {
    const sprite = new WorkersSprite(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL
    );

    const result = await sprite.execHttp(`cd ${WORKSPACE_DIR} && git checkout -b ${branchName}`, {});
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create branch ${branchName}: ${result.stderr}`);
    }
  }

  private async syncRepository(sprite: WorkersSprite): Promise<void> {
    const branchName = this.state?.githubBranchName;

    // Stash any local changes
    await sprite.execHttp(`cd ${WORKSPACE_DIR} && git stash --include-untracked`, {});
    // Fetch latest refs
    await sprite.execHttp(`cd ${WORKSPACE_DIR} && git fetch origin`, {});
    // Pull if remote branch exists
    if (branchName) {
      await sprite.execHttp(`cd ${WORKSPACE_DIR} && git pull origin ${branchName} --rebase || true`, {});
    } else {
      // what to do if the branch doesn't exist?
    }
    // Restore stashed changes
    await sprite.execHttp(`cd ${WORKSPACE_DIR} && git stash pop || true`, {});
    // what if there are conflicts? what if the remote branch doesnt exist?
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
      this.env.SPRITES_API_URL
    );

    // Restart mitmproxy if not running (it doesn't survive hibernation)
    if (!this.mitmSession) {
      await this.startMitmproxyOnVM(spriteName);
    }

    // Refresh GitHub token before sync (may have expired during hibernation)
    try {
      await this.ensureValidToken();
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
    const existingSession = sessions.find((s) => s.id === String(this.state?.agentProcessId));

    // Check if other clients are connected (current client is already counted)
    const connectionCount = [...this.getConnections()].length;
    const otherClientsConnected = connectionCount > 1;

    if (existingSession && otherClientsConnected) {
      // Multiplayer: attach to existing session to not disrupt others
      console.log(`${connectionCount} clients connected and vm-agent session exists, attaching to existing session ${existingSession.id}`);
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
      connection.send(JSON.stringify({
        type: "sync.response",
        messages: [],
      }));
      return;
    }

    const storedMessages = this.messageRepository!.getAllBySession(this.state.sessionId);
    connection.send(JSON.stringify({
      type: "sync.response",
      messages: storedMessages.map((m) => m.message),
    }));
  }

  private handleOperationCancel(): void {
    if (this.agentSession) {
      this.agentSession.write(encodeAgentInput({ type: "cancel" }) + "\n");
    }
  }

  private broadcastMessage(message: ServerMessage, without?: string[]): void {
    this.broadcast(JSON.stringify(message), without);
  }

  /**
   * Retrieves captured HTTP traffic from mitmproxy.
   * Note: mitmdump writes binary format; for human-readable output,
   * use `mitmproxy` or `mitmweb` interactively.
   */
  async getTrafficLogs(): Promise<string> {
    if (!this.state.spriteName) {
      return "No sprite available";
    }

    this.ensureClients();
    const sprite = new WorkersSprite(
      this.state.spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL
    );

    const result = await sprite.execHttp(
      `cat ${HOME_DIR}/.cloude/traffic.mitm 2>/dev/null || echo "No traffic captured"`,
      {}
    );
    return result.stdout ?? "";
  }
}