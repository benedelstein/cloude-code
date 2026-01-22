import { DurableObject } from "cloudflare:workers";
import { SpritesCoordinator, WorkersSprite, SpriteWebsocketSession } from "@/lib/sprites";
import {
  type Session,
  type Message,
  type SessionSettings,
  type ClientMessage,
  type ServerMessage,
} from "@repo/shared";
import type { Env } from "../types";

interface SessionState {
  sessionId: string;
  userId: string;
  repoId: string;
  spriteName: string | null;
  status: Session["status"];
  settings: SessionSettings;
}

interface InitRequest {
  sessionId: string;
  repoId: string;
  settings?: Partial<SessionSettings>;
}

export class SessionAgentDO extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Track connected WebSocket clients (multiple clients can connect to one session) */
  private connectedClients: Map<WebSocket, { clientId: string }> = new Map();
  private spritesCoordinator: SpritesCoordinator | null = null;
  private currentMessageId: string | null = null;
  /**
   * Claude Code session running on the sprite (Workers-compatible)
   */
  private claudeSession: SpriteWebsocketSession | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initializeSchema();
    this.initializeClients();
  }

  private initializeSchema(): void {
    // todo: strong type db? 
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        repo_id TEXT NOT NULL,
        sprite_name TEXT,
        claude_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'creating',
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls_json TEXT,
        stream_position INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES session(id)
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );

      CREATE TABLE IF NOT EXISTS sprite_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        git_commit_sha TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES session(id)
      );

      CREATE TABLE IF NOT EXISTS stream_state (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        total_chunks INTEGER NOT NULL DEFAULT 0,
        last_sent_chunk INTEGER NOT NULL DEFAULT 0,
        pending_chunks_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (session_id) REFERENCES session(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id);
    `);
  }

  private getSession(): SessionState | null {
    const rows = this.sql.exec("SELECT * FROM session LIMIT 1").toArray();
    if (rows.length === 0) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      sessionId: row.id as string,
      userId: row.user_id as string,
      repoId: row.repo_id as string,
      spriteName: row.sprite_name as string | null,
      status: row.status as Session["status"],
      settings: JSON.parse(row.settings_json as string) as SessionSettings,
    };
  }

  private updateSessionStatus(status: Session["status"]): void {
    this.sql.exec(
      "UPDATE session SET status = ?, updated_at = datetime('now')",
      status
    );
  }

  private initializeClients(): void {
    this.spritesCoordinator = new SpritesCoordinator({
      apiKey: this.env.SPRITES_API_KEY,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    console.debug(`fetching ${path}`);

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      console.debug("upgrading to websocket");
      return this.handleWebSocketUpgrade();
    }

    // REST endpoints for DO internal communication
    switch (path) {
      case "/init":
        return this.handleInit(request);
      case "/session":
        if (request.method === "DELETE") {
          return this.handleDeleteSession();
        }
        return this.handleGetSession();
      case "/messages":
        return this.handleGetMessages();
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  private async handleInit(request: Request): Promise<Response> {
    const data = (await request.json()) as InitRequest;

    const settings: SessionSettings = {
      model: data.settings?.model ?? "claude-opus-4-20250514",
      maxTokens: data.settings?.maxTokens ?? 8192,
    };

    // Create session record (only one per DO instance)
    this.sql.exec(
      `INSERT INTO session (id, user_id, repo_id, status, settings_json)
       VALUES (?, ?, ?, ?, ?)`,
      data.sessionId,
      "anonymous", // TODO: dont couple session to 1 user.
      data.repoId,
      "provisioning",
      JSON.stringify(settings)
    );

    // Provision sprite asynchronously
    this.ctx.waitUntil(this.provisionSprite(data.sessionId, data.repoId));

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async provisionSprite(
    sessionId: string,
    repoId: string
  ): Promise<void> {
    try {
      // Create the sprite VM using the original SDK (for sprite lifecycle management)
      const spriteResponse = await this.spritesCoordinator!.createSprite({
        name: `session-${sessionId}`,
        env: {
          GITHUB_TOKEN: this.env.GITHUB_TOKEN,
          ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY,
        },
      });

      // Update session with sprite name
      this.sql.exec(
        "UPDATE session SET sprite_name = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
        spriteResponse.name,
        "cloning",
        sessionId
      );

      this.broadcast({
        type: "sprite.status",
        status: "cloning" as Session["status"],
      } as unknown as ServerMessage);

      // Use Workers-compatible sprite for exec/session operations
      const sprite = new WorkersSprite(spriteResponse.name, this.env.SPRITES_API_KEY, this.env.SPRITES_API_URL);

      // Clone the repo on the sprite using HTTP exec
      console.log(`Cloning repo ${repoId} on sprite ${spriteResponse.name}`);
      const mkdirResult = await sprite.execHttp("mkdir -p /workspace", {});
      console.log(`Mkdir result: exitCode=${mkdirResult.exitCode}, stdout=${mkdirResult.stdout}, stderr=${mkdirResult.stderr}`);

      const cloneResult = await sprite.execHttp(
        `git clone https://github.com/${repoId}.git /workspace`,
        {}
      );
      console.log(`Clone result: exitCode=${cloneResult.exitCode}, stdout=${cloneResult.stdout}, stderr=${cloneResult.stderr}`);

      // Verify clone succeeded by checking if workspace has files
      const verifyResult = await sprite.execHttp("ls -la /workspace", {});
      console.log(`Workspace contents: ${verifyResult.stdout}`);

      if (!verifyResult.stdout || verifyResult.stdout.trim().split("\n").length < 3) {
        throw new Error(`Clone failed - workspace is empty. Clone output: ${cloneResult.stdout || cloneResult.stderr}`);
      }

      // Start Claude Code in a tmux session
      await this.startClaudeSession(spriteResponse.name);

      // Update status to ready
      this.sql.exec(
        "UPDATE session SET status = ?, updated_at = datetime('now') WHERE id = ?",
        "ready",
        sessionId
      );

      this.broadcast({
        type: "sprite.status",
        status: "ready",
      });
    } catch (error) {
      console.error("Failed to provision sprite:", error);
      this.updateSessionStatus("error");
      this.broadcast({
        type: "sprite.status",
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private async startClaudeSession(spriteName: string): Promise<void> {
    // Use Workers-compatible sprite for WebSocket session
    const sprite = new WorkersSprite(spriteName, this.env.SPRITES_API_KEY, this.env.SPRITES_API_URL);

    // Start Claude Code in a tmux session (tty required for interactive CLI)
    this.claudeSession = sprite.createSession("claude", [], {
      cwd: "/workspace",
      tty: true,
      env: {
        ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY,
      },
    });
    // Wire stdout to broadcast
    this.claudeSession.onStdout((data: string) => {
      this.broadcast({
        type: "claude.output",
        data,
      } as unknown as ServerMessage);
    });

    // Wire stderr to broadcast
    this.claudeSession.onStderr((data: string) => {
      console.error(`Claude session stderr: ${data}`);
      this.broadcast({
        type: "claude.output",
        data,
        isStderr: true,
      } as unknown as ServerMessage);
    });

    // Handle session exit
    this.claudeSession.onExit((code: number) => {
      console.log(`Claude session exited with code ${code}`);
      this.claudeSession = null;
      this.broadcast({
        type: "claude.exit",
        exitCode: code,
      } as unknown as ServerMessage);
    });

    // Start the WebSocket connection
    await this.claudeSession.start();

    // Get and store the session ID for reattachment
    const sessions = await this.spritesCoordinator!.listSessions(spriteName);
    console.log(`${sessions.length} sessions on sprite: ${JSON.stringify(sessions)}`);
    const claudeSession = sessions.find((s) => s.command.includes("claude"));
    if (claudeSession) {
      this.sql.exec(
        "UPDATE session SET claude_session_id = ? WHERE sprite_name = ?",
        String(claudeSession.id),
        spriteName
      );
    } else {
      console.error("No Claude session found");
    }
  }

  private handleGetSession(): Response {
    const session = this.getSession();
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    return new Response(JSON.stringify(session), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private handleGetMessages(): Response {
    const rows = this.sql
      .exec("SELECT * FROM messages ORDER BY created_at ASC")
      .toArray();

    const messages = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id,
        sessionId: r.session_id,
        role: r.role,
        content: r.content,
        toolCalls: r.tool_calls_json ? JSON.parse(r.tool_calls_json as string) : undefined,
        createdAt: r.created_at,
      };
    });

    return new Response(JSON.stringify(messages), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleDeleteSession(): Promise<Response> {
    const session = this.getSession();

    // Clean up sprite if exists
    if (session?.spriteName && this.spritesCoordinator) {
      try {
        await this.spritesCoordinator.deleteSprite(session.spriteName);
      } catch (error) {
        console.error("Failed to delete sprite:", error);
      }
    }

    // Delete all data
    this.sql.exec("DELETE FROM stream_state");
    this.sql.exec("DELETE FROM tool_calls");
    this.sql.exec("DELETE FROM sprite_checkpoints");
    this.sql.exec("DELETE FROM messages");
    this.sql.exec("DELETE FROM session");

    return new Response(JSON.stringify({ deleted: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // WebSocket Hibernation API
  private handleWebSocketUpgrade(): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const clientId = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    this.connectedClients.set(server, { clientId });

    // Send initial connection message
    const session = this.getSession();

    server.send(
      JSON.stringify({
        type: "connected",
        sessionId: session?.sessionId ?? "",
        status: session?.status ?? "unknown",
      } satisfies ServerMessage)
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called when WebSocket receives a message (hibernation-aware)
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // Reinitialize clients after hibernation wake
    if (!this.spritesCoordinator) {
      this.initializeClients();
    }

    try {
      const data = JSON.parse(message) as ClientMessage;
      await this.handleClientMessage(ws, data);
    } catch (error) {
      console.error("Failed to handle message:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Failed to parse message",
        } satisfies ServerMessage)
      );
    }
  }

  // Called when WebSocket closes (hibernation-aware)
  async webSocketClose(ws: WebSocket): Promise<void> {
    this.connectedClients.delete(ws);
  }

  // Called when WebSocket errors (hibernation-aware)
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("WebSocket error:", error);
    this.connectedClients.delete(ws);
  }

  private async handleClientMessage(
    ws: WebSocket,
    message: ClientMessage
  ): Promise<void> {
    switch (message.type) {
      case "chat.message":
        await this.handleChatMessage(ws, message.content);
        break;
      case "stream.ack":
        this.handleStreamAck(message.messageId, message.chunkIndex);
        break;
      case "sync.request":
        await this.handleSyncRequest(ws, message);
        break;
      case "operation.cancel":
        this.handleOperationCancel();
        break;
    }
  }

  private async handleChatMessage(
    ws: WebSocket,
    content: string
  ): Promise<void> {
    const session = this.getSession();
    if (!session || session.status !== "ready") {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "SESSION_NOT_READY",
          message: `Session is ${session?.status ?? "not found"}`,
        } satisfies ServerMessage)
      );
      return;
    }

    // Ensure we have a Claude session (reattach if needed after hibernation)
    if (!this.claudeSession && session.spriteName) {
      await this.reattachClaudeSession(session.spriteName);
    }

    if (!this.claudeSession) {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "NO_CLAUDE_SESSION",
          message: "Claude session not available",
        } satisfies ServerMessage)
      );
      return;
    }

    // Store user message
    const userMessageId = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)",
      userMessageId,
      session.sessionId,
      "user",
      content
    );

    // Pipe the message to Claude's stdin using Workers-compatible write
    this.claudeSession.write(content + "\n");
  }

  private async reattachClaudeSession(spriteName: string): Promise<void> {
    // Get stored session ID
    const rows = this.sql.exec(
      "SELECT claude_session_id FROM session WHERE sprite_name = ?",
      spriteName
    ).toArray();

    if (rows.length === 0 || !rows[0]) return;

    const storedSessionId = (rows[0] as Record<string, unknown>).claude_session_id as string | null;
    if (!storedSessionId) return;

    // Use Workers-compatible sprite
    const sprite = new WorkersSprite(spriteName, this.env.SPRITES_API_KEY, this.env.SPRITES_API_URL);

    // Check if session still exists (stored id is string, API returns number)
    const sessions = await this.spritesCoordinator!.listSessions(spriteName);
    const existingSession = sessions.find((s) => String(s.id) === storedSessionId);

    if (existingSession) {
      // Reattach to existing session using Workers-compatible method
      this.claudeSession = sprite.attachSession(storedSessionId, { tty: true });

      // Rewire stdout/stderr
      this.claudeSession.onStdout((data: string) => {
        this.broadcast({
          type: "claude.output",
          data,
        } as unknown as ServerMessage);
      });

      this.claudeSession.onStderr((data: string) => {
        this.broadcast({
          type: "claude.output",
          data,
          isStderr: true,
        } as unknown as ServerMessage);
      });

      this.claudeSession.onExit((code: number) => {
        console.log(`Claude session exited with code ${code}`);
        this.claudeSession = null;
        this.broadcast({
          type: "claude.exit",
          exitCode: code,
        } as unknown as ServerMessage);
      });

      await this.claudeSession.start();
      console.log(`Reattached to Claude session ${storedSessionId}`);
    } else {
      // Session no longer exists, start a new one
      console.log("Previous Claude session not found, starting new one");
      await this.startClaudeSession(spriteName);
    }
  }

  private handleStreamAck(messageId: string, chunkIndex: number): void {
    // TODO: implement
  }

  private handleSyncRequest(ws: WebSocket, message: ClientMessage): void {
    // todo: implement
  }

  private handleOperationCancel(): void {
    // Close the Claude session if active
    if (this.claudeSession) {
      this.claudeSession.close();
      this.claudeSession = null;
    }
  }

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch(error) {
        // WebSocket might be closed
        console.error("Failed to broadcast message to WebSocket:", error);
      }
    }
  }
}
