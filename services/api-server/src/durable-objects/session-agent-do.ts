import { SpritesCoordinator, WorkersSprite, SpriteWebsocketSession, SpriteServerMessage } from "@/lib/sprites";
import {
  type SessionInfo,
  type SessionSettings,
  type ClientMessage,
  type ServerMessage,
  type AgentOutput,
  decodeAgentOutput,
  encodeAgentInput,
  Session,
} from "@repo/shared";
import type { Env } from "../types";
import VM_AGENT_SCRIPT from "@repo/vm-agent/dist/vm-agent.bundle.js";
import { Agent, type Connection } from "agents";
import { MessageRepository } from "./repositories/message-repository";

const WORKSPACE_DIR = "/home/sprite/workspace";
const HOME_DIR = "/home/sprite";

// Session metadata stored in Agent state (survives hibernation)
type AgentState = {
  sessionId: string;
  userId: string;
  repoId: string;
  spriteName: string | null;
  githubBranchName: string | null;
  /** Session ID given by the Claude Agent SDK */
  claudeSessionId: string | null;
  /** ID of the agent process session running on the sprite */
  agentProcessId: number | null;
  status: Session["status"];
  settings: SessionSettings;
  createdAt: string;
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
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        raw_data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `;
    this.sql`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)`;
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

  private updateStatus(status: Session["status"]): void {
    this.setState({ ...this.state, status });
  }

  // ============================================
  // HTTP Handlers
  // ============================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
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

    // Sub-resources
    if (path === "/messages" && request.method === "GET") {
      return this.handleGetMessages();
    }

    // Pass unhandled requests to Agent SDK (WebSocket upgrades, internal setup routes, etc.)
    return super.fetch(request);
  }

  // Called by Agent SDK when a new WebSocket connection is established
  onConnect(connection: Connection): void {
    // Send initial connection state
    connection.send(JSON.stringify({
      type: "connected",
      sessionId: this.state?.sessionId ?? "",
      status: this.state?.status ?? "unknown",
    } satisfies ServerMessage));

    // Send message history
    if (this.state?.sessionId && this.messageRepository) {
      this.ensureClients();
      const messages = this.messageRepository!.getAllBySession(this.state.sessionId);
      connection.send(JSON.stringify({
        type: "sync.response",
        messages,
      }));
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
    if (this.state?.sessionId) {
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

    // Initialize agent state
    this.setState({
      sessionId: data.sessionId,
      userId: "anonymous", // todo
      repoId: data.repoId,
      spriteName: null,
      githubBranchName: null,
      claudeSessionId: null,
      agentProcessId: null,
      status: "provisioning",
      settings,
      createdAt: new Date().toISOString(),
    });

    // Provision sprite asynchronously
    this.ctx.waitUntil(this.provisionSprite(data.sessionId, data.repoId));

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async provisionSprite(sessionId: string, repoId: string): Promise<void> {
    try {
      this.ensureClients();

      const spriteResponse = await this.spritesCoordinator!.createSprite({
        name: `session-${sessionId}`,
        env: {
          GITHUB_TOKEN: this.env.GITHUB_TOKEN,
          ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY,
        },
      });

      this.setState({
        ...this.state,
        spriteName: spriteResponse.name,
        status: "cloning",
      });

      this.broadcastMessage({
        type: "sprite.status",
        status: "cloning" as Session["status"],
      } as unknown as ServerMessage);

      const sprite = new WorkersSprite(
        spriteResponse.name,
        this.env.SPRITES_API_KEY,
        this.env.SPRITES_API_URL
      );

      // Clone the repo
      // check if the repo is already cloned
      const isCloned = await sprite.execHttp(`test -d ${WORKSPACE_DIR}/.git && echo 'exists' || echo 'empty'`, {});
      if (isCloned.stdout.includes("exists")) {
        console.log(`Repo ${repoId} already cloned on sprite ${spriteResponse.name}`);
        // make sure we're up to date?
      } else {
        console.log(`Cloning repo ${repoId} on sprite ${spriteResponse.name}`);
        await sprite.execHttp(`mkdir -p ${WORKSPACE_DIR}`, {});
        const cloneResult = await sprite.execHttp(
          `git clone https://github.com/${repoId}.git ${WORKSPACE_DIR}`,
          {}
        );
        console.log(`Clone result: exitCode=${cloneResult.exitCode}`);
        // we need to switch to a new branch too.
        // Verify clone
        const verifyResult = await sprite.execHttp(`ls -la ${WORKSPACE_DIR}`, {});
        if (!verifyResult.stdout || verifyResult.stdout.trim().split("\n").length < 3) {
          throw new Error(`Clone failed - workspace empty: ${cloneResult.stderr}`);
        }
      }


      // Start vm-agent
      await this.startAgentOnVM(spriteResponse.name);

      this.updateStatus("ready");
      this.broadcastMessage({ type: "sprite.status", status: "ready" });
    } catch (error) {
      console.error("Failed to provision sprite:", error);
      this.updateStatus("error");
      this.broadcastMessage({
        type: "sprite.status",
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private async startAgentOnVM(spriteName: string): Promise<void> {
    const sprite = new WorkersSprite(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL
    );

    await sprite.writeFile(`${HOME_DIR}/.cloude/agent.js`, VM_AGENT_SCRIPT);

    this.agentSession = sprite.createSession("bun", ["run", `${HOME_DIR}/.cloude/agent.js`], {
      cwd: WORKSPACE_DIR,
      tty: false,
      env: {
        ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY,
      },
    });

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

    await this.agentSession.start();
    console.log(`vm-agent started on sprite ${spriteName}`);
  }

  private handleAgentStdout(data: string): void {
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
      case "ready":
        this.setState({ ...this.state, claudeSessionId: output.sessionId });
        this.broadcastMessage({
          type: "agent.ready",
          sessionId: output.sessionId,
        });
        break;

      case "sdk":
        this.broadcastMessage({
          type: "agent.event",
          message: output.message,
        });
        // Save agent events to message repository
        this.saveAgentEvent(output.message);
        break;

      case "error":
        this.broadcastMessage({
          type: "error",
          code: "AGENT_ERROR",
          message: output.error,
        });
        break;
    }
  }

  private handleAgentServerMessage(msg: SpriteServerMessage): void {
    switch (msg.type) {
      case "session_info":
        console.log(`vm-agent session info: ${JSON.stringify(msg.session_id)}`);
        this.setState({ ...this.state, agentProcessId: msg.session_id });
        break;
      default:
        break;
    }
  }

  private saveAgentEvent(message: unknown): void {
    if (!this.state?.sessionId || !this.messageRepository) return;

    // Extract content from SDK message if it's a text event
    const msg = message as { type?: string; content?: string };
    this.messageRepository.create({
      sessionId: this.state.sessionId,
      role: "assistant", // is this always assistant?
      content: msg.content ?? "",
      // content: msg.content,
      rawData: message,
    });
    // if (msg.type === "text" && msg.content) {
    // }
  }

  private handleGetSession(): Response {
    if (!this.state?.sessionId) {
      return new Response("Session not found", { status: 404 });
    }

    // should we re-provision the sprite here?

    return new Response(JSON.stringify({
      sessionId: this.state.sessionId,
      status: this.state.status,
      repoId: this.state.repoId,
    } satisfies SessionInfo), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleGetMessages(): Response {
    this.ensureClients();

    if (!this.state?.sessionId) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const messages = this.messageRepository!.getAllBySession(this.state.sessionId);
    return new Response(JSON.stringify(messages), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleDeleteSession(): Promise<Response> {
    this.ensureClients();

    // Clean up sprite
    if (this.state?.spriteName && this.spritesCoordinator) {
      try {
        await this.spritesCoordinator.deleteSprite(this.state.spriteName);
      } catch (error) {
        console.error("Failed to delete sprite:", error);
      }
    }

    // Clear messages
    if (this.state?.sessionId) {
      const sessionId = this.state.sessionId;
      this.sql`DELETE FROM messages WHERE session_id = ${sessionId}`;
    }

    // Reset state
    this.setState(undefined as unknown as AgentState);

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
    if (!this.state || this.state.status !== "ready") {
      connection.send(JSON.stringify({
        type: "error",
        code: "SESSION_NOT_READY",
        message: `Session is ${this.state?.status ?? "not found"}`,
      } satisfies ServerMessage));
      return;
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

    // Store user message
    this.ensureClients();
    this.messageRepository!.create({
      sessionId: this.state.sessionId,
      role: "user",
      content,
    });

    // Send to vm-agent
    this.agentSession.write(encodeAgentInput({ type: "chat", content }) + "\n");
  }

  private async reattachAgentSession(spriteName: string): Promise<void> {
    this.ensureClients();

    const sprite = new WorkersSprite(
      spriteName,
      this.env.SPRITES_API_KEY,
      this.env.SPRITES_API_URL
    );

    const sessions = await this.spritesCoordinator!.listSessions(spriteName);
    const existingSession = sessions.find((s) => s.id === this.state?.agentProcessId);

    if (existingSession) {
      this.agentSession = sprite.attachSession(String(existingSession.id), {});

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

      await this.agentSession.start();
      console.log(`Reattached to vm-agent session ${existingSession.id}`);
    } else {
      console.log("Previous vm-agent session not found, starting new one");
      await this.startAgentOnVM(spriteName);
    }
  }

  private handleSyncRequest(connection: Connection): void {
    this.ensureClients();

    if (!this.state?.sessionId) {
      connection.send(JSON.stringify({
        type: "sync.response",
        messages: [],
      }));
      return;
    }

    const messages = this.messageRepository!.getAllBySession(this.state.sessionId);
    connection.send(JSON.stringify({
      type: "sync.response",
      messages,
    }));
  }

  private handleOperationCancel(): void {
    if (this.agentSession) {
      this.agentSession.write(encodeAgentInput({ type: "cancel" }) + "\n");
    }
  }

  private broadcastMessage(message: ServerMessage): void {
    this.broadcast(JSON.stringify(message));
  }
}