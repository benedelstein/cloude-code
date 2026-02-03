import { SessionOptions, SpriteServerMessage, SpriteServerMessageSchema } from "./types";

interface WorkersSessionOptions extends SessionOptions {
    sessionId?: string;
}

/**
 * Websocket session client compatible with cloudflare workers api.
 */
export class SpriteWebsocketSession {
    private ws: WebSocket | null = null;
    private spriteName: string;
    private apiKey: string;
    private baseUrl: string;
    private command: string;
    private args: string[];
    private options: WorkersSessionOptions;
  
    private stdoutHandlers: Set<(data: string) => void> = new Set();
    private stderrHandlers: Set<(data: string) => void> = new Set();
    private exitHandlers: Set<(code: number) => void> = new Set();
    private errorHandlers: Set<(error: Error) => void> = new Set();
    private serverMessageHandlers: Set<(msg: SpriteServerMessage) => void> = new Set();
  
    constructor(
      spriteName: string,
      apiKey: string,
      baseUrl: string,
      command: string,
      args: string[],
      options: WorkersSessionOptions = {}
    ) {
      this.spriteName = spriteName;
      this.apiKey = apiKey;
      this.baseUrl = baseUrl;
      this.command = command;
      this.args = args;
      this.options = options;
    }
  
    async start(): Promise<void> {
      const wsUrl = new URL(`${this.baseUrl}/v1/sprites/${this.spriteName}/exec`);
  
      // Build command params (Sprites API format)
      if (this.command) {
        // Add command and each argument as separate 'cmd' params
        wsUrl.searchParams.append("cmd", this.command);
        for (const arg of this.args) {
          wsUrl.searchParams.append("cmd", arg);
        }
        // Also set 'path' to the command
        wsUrl.searchParams.set("path", this.command);
      }
  
      // Enable stdin so server accepts input frames
      wsUrl.searchParams.set("stdin", "true");
  
      // Session ID for reattachment
      if (this.options.sessionId) {
        wsUrl.searchParams.set("id", this.options.sessionId);
      }
  
      // Working directory (Sprites uses 'dir' not 'cwd')
      if (this.options.cwd) {
        wsUrl.searchParams.set("dir", this.options.cwd);
      }
  
      // TTY mode
      if (this.options.tty) {
        wsUrl.searchParams.set("tty", "true");
      }
  
      // Environment variables
      if (this.options.env) {
        for (const [key, value] of Object.entries(this.options.env)) {
          wsUrl.searchParams.append("env", `${key}=${value}`);
        }
      }
  
      // Detachable session (tmux)
      if (!this.options.sessionId) {
        wsUrl.searchParams.set("detachable", "true");
      }
  
      // Workers fetch upgrade uses https:// (not wss://) - Workers handles the protocol
      const response = await fetch(wsUrl.toString(), {
        headers: {
          Upgrade: "websocket",
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
  
      // Workers WebSocket from fetch response
      const ws = response.webSocket;
      if (!ws) {
        const body = await response.text();
        console.error(
          `WebSocket upgrade failed. Status: ${response.status}, Body: ${body}`
        );
        throw new Error(
          `Server didn't accept WebSocket connection: ${response.status} - ${body}`
        );
      }
  
      // Accept the WebSocket connection to handle it in JS
      ws.accept();
      this.ws = ws;
  
      // Set up message handling
      ws.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });
  
      ws.addEventListener("close", () => {
        this.ws = null;
      });
  
      ws.addEventListener("error", () => {
        const error = new Error("WebSocket error");
        this.errorHandlers.forEach((h) => h(error));
      });
    }
  
    private handleMessage(data: unknown): void {
      // Workers runtime quirk: ArrayBuffer comes as typeof "object" but instanceof ArrayBuffer may be false
      const isBinary = data instanceof ArrayBuffer ||
        (typeof data === "object" && data !== null && "byteLength" in data);
  
      if (this.options.tty) {
        // TTY mode: binary = raw stdout, string = JSON control messages
        if (isBinary) {
          const buffer = data as ArrayBuffer;
          const text = new TextDecoder().decode(buffer);
          this.stdoutHandlers.forEach((h) => h(text));
        } else if (typeof data === "string") {
          try {
            const msg: unknown = JSON.parse(data);
            this.dispatchServerMessage(msg);
          } catch {
            // Non-JSON string - treat as stdout
            this.stdoutHandlers.forEach((h) => h(data));
          }
        }
      } else {
        // Non-TTY mode: stream-based binary protocol
        if (data instanceof ArrayBuffer) {
          const view = new DataView(data);
          const streamId = view.getUint8(0);
          const payload = new Uint8Array(data, 1);
          const text = new TextDecoder().decode(payload);
  
          switch (streamId) {
            case 1: // stdout
              this.stdoutHandlers.forEach((h) => h(text));
              break;
            case 2: // stderr
              this.stderrHandlers.forEach((h) => h(text));
              break;
            case 3: { // exit
              const exitCode = view.getUint8(1);
              this.exitHandlers.forEach((h) => h(exitCode));
              break;
            }
          }
        } else if (typeof data === "string") {
          // JSON server messages in non-TTY mode
          try {
            const msg: unknown = JSON.parse(data);
            this.dispatchServerMessage(msg);
          } catch {
            // Non-JSON string - unexpected in non-TTY mode
          }
        }
      }
    }
  
    private dispatchServerMessage(msg: unknown): void {
      const result = SpriteServerMessageSchema.safeParse(msg);
      if (!result.success) {
        console.warn("[SpriteWebsocketSession] Unknown server message:", msg, result.error.format());
        return;
      }

      const parsed = result.data;
      this.serverMessageHandlers.forEach((h) => h(parsed));

      // Also dispatch to legacy exitHandlers for backwards compatibility
      if (parsed.type === "exit") {
        this.exitHandlers.forEach((h) => h(parsed.exit_code));
      }
    }

    write(data: string): void {
      if (!this.ws) throw new Error("WebSocket not connected");

      const encoder = new TextEncoder();
      const textBytes = encoder.encode(data);

      if (this.options.tty) {
        // TTY mode: send raw text
        this.ws.send(textBytes);
      } else {
        // Non-TTY mode: prefix with stream ID 0 (stdin)
        const buffer = new ArrayBuffer(1 + textBytes.length);
        const view = new Uint8Array(buffer);
        view[0] = 0; // stdin stream ID
        view.set(textBytes, 1);
        this.ws.send(buffer);
      }
    }

    closeStdin(): void {
      if (!this.ws) throw new Error("WebSocket not connected");

      if (this.options.tty) {
        // TTY mode: send Ctrl+D (EOT character)
        const encoder = new TextEncoder();
        this.ws.send(encoder.encode("\x04"));
      } else {
        // Non-TTY mode: send stdin_eof (stream ID 4)
        const buffer = new ArrayBuffer(1);
        const view = new DataView(buffer);
        view.setUint8(0, 4); // stdin_eof stream ID
        this.ws.send(buffer);
      }
    }

    resize(cols: number, rows: number): void {
      if (!this.ws) throw new Error("WebSocket not connected");
      if (!this.options.tty) throw new Error("Resize only supported in TTY mode");

      this.ws.send(JSON.stringify({ type: "resi", cols, rows }));
    }

    onStdout(handler: (data: string) => void): () => void {
      this.stdoutHandlers.add(handler);
      return () => this.stdoutHandlers.delete(handler);
    }
  
    onStderr(handler: (data: string) => void): () => void {
      this.stderrHandlers.add(handler);
      return () => this.stderrHandlers.delete(handler);
    }
  
    onExit(handler: (code: number) => void): () => void {
      this.exitHandlers.add(handler);
      return () => this.exitHandlers.delete(handler);
    }
  
    onError(handler: (error: Error) => void): () => void {
      this.errorHandlers.add(handler);
      return () => this.errorHandlers.delete(handler);
    }

    onServerMessage(handler: (msg: SpriteServerMessage) => void): () => void {
      this.serverMessageHandlers.add(handler);
      return () => this.serverMessageHandlers.delete(handler);
    }
  
    close(): void {
      this.ws?.close();
      this.ws = null;
    }
  
    get isConnected(): boolean {
      return this.ws !== null;
    }
  }
  