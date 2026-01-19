import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import {
  SpritesClient,
  type ExecOutput,
} from "@repo/sprites-sdk";
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

export class SessionAgent extends DurableObject<Env> {
  private sql: SqlStorage;
  // Track connected WebSocket clients (multiple clients can connect to one session)
  private connectedClients: Map<WebSocket, { clientId: string }> = new Map();
  private spritesClient: SpritesClient | null = null;
  private anthropic: Anthropic | null = null;
  private currentMessageId: string | null = null;
  private isProcessing = false;

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
    this.spritesClient = new SpritesClient({
      baseUrl: this.env.SPRITES_API_URL,
      apiKey: this.env.SPRITES_API_KEY,
    });
    this.anthropic = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
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
      const sprite = await this.spritesClient!.createSprite({
        env: {
          GITHUB_TOKEN: this.env.GITHUB_TOKEN,
          REPO_ID: repoId,
        },
      });

      // Update session with sprite name
      this.sql.exec(
        "UPDATE session SET sprite_name = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
        sprite.name,
        "ready",
        sessionId
      );

      // Notify all connected clients
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
    if (session?.spriteName && this.spritesClient) {
      try {
        await this.spritesClient.deleteSprite(session.spriteName);
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
    const lastMessage = this.getLastMessage();

    server.send(
      JSON.stringify({
        type: "connected",
        sessionId: session?.sessionId ?? "",
        status: session?.status ?? "unknown",
        lastMessageId: lastMessage?.id,
      } satisfies ServerMessage)
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called when WebSocket receives a message (hibernation-aware)
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // Reinitialize clients after hibernation wake
    if (!this.spritesClient || !this.anthropic) {
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
    if (this.isProcessing) {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "ALREADY_PROCESSING",
          message: "A message is already being processed",
        } satisfies ServerMessage)
      );
      return;
    }

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

    this.isProcessing = true;
    const userMessageId = crypto.randomUUID();

    // Store user message
    this.sql.exec(
      "INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)",
      userMessageId,
      session.sessionId,
      "user",
      content
    );

    // Create assistant message placeholder
    const assistantMessageId = crypto.randomUUID();
    this.currentMessageId = assistantMessageId;

    this.sql.exec(
      "INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)",
      assistantMessageId,
      session.sessionId,
      "assistant",
      ""
    );

    // Initialize stream state
    this.sql.exec(
      `INSERT INTO stream_state (id, session_id, message_id, total_chunks, last_sent_chunk, pending_chunks_json)
       VALUES (?, ?, ?, 0, 0, '[]')`,
      crypto.randomUUID(),
      session.sessionId,
      assistantMessageId
    );

    // Notify all clients that message is starting
    this.broadcast({
      type: "message.start",
      messageId: assistantMessageId,
    });

    try {
      await this.streamResponse(session, content, assistantMessageId);
    } catch (error) {
      console.error("Failed to stream response:", error);
      this.broadcast({
        type: "error",
        code: "STREAM_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      this.isProcessing = false;
      this.currentMessageId = null;
    }
  }

  private async streamResponse(
    session: SessionState,
    userMessage: string,
    assistantMessageId: string
  ): Promise<void> {
    if (!this.anthropic) {
      throw new Error("Anthropic client not initialized");
    }

    // Get conversation history
    const history = this.getConversationHistory();

    // Build messages array
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: "user", content: userMessage },
    ];

    // Define tools for Claude
    const tools = this.getTools();

    let chunkIndex = 0;
    let fullContent = "";

    const stream = this.anthropic.messages.stream({
      model: session.settings.model,
      max_tokens: session.settings.maxTokens,
      messages,
      tools,
      system: this.getSystemPrompt(session.repoId),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          const text = event.delta.text;
          fullContent += text;

          // Store chunk and broadcast to all connected clients
          this.storeChunk(assistantMessageId, chunkIndex, text);
          this.broadcast({
            type: "stream.chunk",
            messageId: assistantMessageId,
            chunkIndex,
            content: text,
          });
          chunkIndex++;
        }
      } else if (event.type === "content_block_stop") {
        // Check if this was a tool use block
        const block = (event as unknown as { content_block?: Anthropic.ContentBlock }).content_block;
        if (block?.type === "tool_use") {
          await this.handleToolUse(
            assistantMessageId,
            block.id,
            block.name,
            block.input as Record<string, unknown>
          );
        }
      }
    }

    // Update message content in DB
    this.sql.exec(
      "UPDATE messages SET content = ? WHERE id = ?",
      fullContent,
      assistantMessageId
    );

    // Update stream state
    this.sql.exec(
      "UPDATE stream_state SET total_chunks = ? WHERE message_id = ?",
      chunkIndex,
      assistantMessageId
    );

    // Notify all clients of completion
    this.broadcast({
      type: "message.complete",
      messageId: assistantMessageId,
      totalChunks: chunkIndex,
    });
  }

  private async handleToolUse(
    messageId: string,
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<void> {
    // Store tool call
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO tool_calls (id, message_id, tool_name, input_json, status)
       VALUES (?, ?, ?, ?, 'running')`,
      id,
      messageId,
      toolName,
      JSON.stringify(input)
    );

    // Notify all clients
    this.broadcast({
      type: "tool.use",
      toolCallId: id,
      messageId,
      toolName,
      input,
    });

    try {
      const output = await this.executeTool(toolName, input);

      // Update tool call with result
      this.sql.exec(
        "UPDATE tool_calls SET output = ?, status = 'completed' WHERE id = ?",
        output,
        id
      );

      // Notify all clients
      this.broadcast({
        type: "tool.result",
        toolCallId: id,
        output,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      this.sql.exec(
        "UPDATE tool_calls SET output = ?, status = 'failed' WHERE id = ?",
        errorMessage,
        id
      );

      this.broadcast({
        type: "tool.result",
        toolCallId: id,
        output: errorMessage,
        isError: true,
      });
    }
  }

  private async executeTool(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<string> {
    const session = this.getSession();
    if (!session?.spriteName || !this.spritesClient) {
      throw new Error("Sprite not available");
    }

    switch (toolName) {
      case "bash": {
        const command = input.command as string;
        return this.executeOnSprite(session.spriteName, command);
      }
      case "read_file": {
        const path = input.path as string;
        return this.executeOnSprite(session.spriteName, `cat "${path}"`);
      }
      case "write_file": {
        const path = input.path as string;
        const content = input.content as string;
        // Use heredoc for safe content writing
        const escapedContent = content.replace(/'/g, "'\\''");
        return this.executeOnSprite(
          session.spriteName,
          `cat > "${path}" << 'CLOUDE_EOF'\n${escapedContent}\nCLOUDE_EOF`
        );
      }
      case "list_files": {
        const path = (input.path as string) ?? ".";
        return this.executeOnSprite(session.spriteName, `ls -la "${path}"`);
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async executeOnSprite(
    spriteName: string,
    command: string
  ): Promise<string> {
    if (!this.spritesClient) {
      throw new Error("Sprites client not initialized");
    }

    return new Promise(async (resolve, reject) => {
      const conn = this.spritesClient!.createExecConnection(spriteName);
      let output = "";
      let stderr = "";

      conn.onMessage((msg: ExecOutput) => {
        if (msg.type === "stdout" && msg.data) {
          output += msg.data;
        } else if (msg.type === "stderr" && msg.data) {
          stderr += msg.data;
        } else if (msg.type === "exit") {
          conn.close();
          if (msg.exitCode !== 0) {
            resolve(stderr || output || `Exit code: ${msg.exitCode}`);
          } else {
            resolve(output);
          }
        }
      });

      conn.onError((err) => {
        conn.close();
        reject(err);
      });

      try {
        await conn.connect();
        conn.exec({ command, timeout: 30000 });
      } catch (err) {
        reject(err);
      }
    });
  }

  private getConversationHistory(): Anthropic.MessageParam[] {
    const rows = this.sql
      .exec(
        "SELECT role, content FROM messages WHERE content != '' ORDER BY created_at ASC"
      )
      .toArray();

    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        role: r.role as "user" | "assistant",
        content: r.content as string,
      };
    });
  }

  private getLastMessage(): Message | null {
    const rows = this.sql
      .exec("SELECT * FROM messages ORDER BY created_at DESC LIMIT 1")
      .toArray();

    if (rows.length === 0) return null;

    const r = rows[0] as Record<string, unknown>;
    return {
      id: r.id as string,
      sessionId: r.session_id as string,
      role: r.role as "user" | "assistant",
      content: r.content as string,
      createdAt: r.created_at as string,
    };
  }

  private storeChunk(
    messageId: string,
    chunkIndex: number,
    content: string
  ): void {
    // Get current pending chunks
    const rows = this.sql
      .exec(
        "SELECT pending_chunks_json FROM stream_state WHERE message_id = ?",
        messageId
      )
      .toArray();

    if (rows.length > 0) {
      const r = rows[0] as Record<string, unknown>;
      const chunks = JSON.parse(r.pending_chunks_json as string) as Array<{
        index: number;
        content: string;
      }>;
      chunks.push({ index: chunkIndex, content });

      this.sql.exec(
        "UPDATE stream_state SET pending_chunks_json = ?, total_chunks = ? WHERE message_id = ?",
        JSON.stringify(chunks),
        chunkIndex + 1,
        messageId
      );
    }
  }

  private handleStreamAck(messageId: string, chunkIndex: number): void {
    this.sql.exec(
      "UPDATE stream_state SET last_sent_chunk = ? WHERE message_id = ? AND last_sent_chunk < ?",
      chunkIndex,
      messageId,
      chunkIndex
    );
  }

  private async handleSyncRequest(
    ws: WebSocket,
    request: { lastMessageId?: string; lastChunkIndex?: number }
  ): Promise<void> {
    // Get messages after the last known message
    let messages: unknown[] = [];

    if (request.lastMessageId) {
      const rows = this.sql
        .exec(
          `SELECT * FROM messages
           WHERE created_at > (SELECT created_at FROM messages WHERE id = ?)
           ORDER BY created_at ASC`,
          request.lastMessageId
        )
        .toArray();
      messages = rows;
    } else {
      const rows = this.sql
        .exec("SELECT * FROM messages ORDER BY created_at ASC")
        .toArray();
      messages = rows;
    }

    // Get pending chunks if there's an active stream
    let pendingChunks: unknown[] = [];

    if (this.currentMessageId && request.lastChunkIndex !== undefined) {
      const rows = this.sql
        .exec(
          "SELECT pending_chunks_json FROM stream_state WHERE message_id = ?",
          this.currentMessageId
        )
        .toArray();

      if (rows.length > 0) {
        const r = rows[0] as Record<string, unknown>;
        const chunks = JSON.parse(r.pending_chunks_json as string) as Array<{
          index: number;
          content: string;
        }>;
        pendingChunks = chunks.filter((c) => c.index > request.lastChunkIndex!);
      }
    }

    ws.send(
      JSON.stringify({
        type: "sync.response",
        messages,
        pendingChunks,
      } satisfies ServerMessage)
    );
  }

  private handleOperationCancel(): void {
    this.isProcessing = false;
  }

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // WebSocket might be closed
      }
    }
  }

  private getTools(): Anthropic.Tool[] {
    return [
      {
        name: "bash",
        description:
          "Execute a bash command on the remote development environment",
        input_schema: {
          type: "object" as const,
          properties: {
            command: {
              type: "string",
              description: "The bash command to execute",
            },
          },
          required: ["command"],
        },
      },
      {
        name: "read_file",
        description: "Read the contents of a file",
        input_schema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "The path to the file to read",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file",
        input_schema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "The path to the file to write",
            },
            content: {
              type: "string",
              description: "The content to write to the file",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "list_files",
        description: "List files in a directory",
        input_schema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "The directory path to list (defaults to current directory)",
            },
          },
          required: [],
        },
      },
    ];
  }

  private getSystemPrompt(repoId: string): string {
    // todo: customize this.
    return `You are an AI coding assistant working on the repository "${repoId}".
You have access to a remote development environment with the following tools:
- bash: Execute shell commands
- read_file: Read file contents
- write_file: Write to files
- list_files: List directory contents

Help the user with their coding tasks. Be concise but thorough.
When making changes, explain what you're doing and why.
Always verify your changes work by running appropriate commands.`;
  }
}
