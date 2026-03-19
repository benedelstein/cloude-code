import {
  AttachSessionOptions,
  NewExecSessionOptions,
  SessionInfoMessageSchema,
  SpriteServerMessage,
  SpriteServerMessageSchema,
} from "./types";
import { createLogger } from "@/lib/logger";

type NewExecSessionConfig = {
  mode: "exec";
  command: string;
  args: string[];
  options: NewExecSessionOptions;
};

type AttachSessionConfig = {
  mode: "attach";
  sessionId: string;
  options: AttachSessionOptions;
};

type WorkersSessionConfig = NewExecSessionConfig | AttachSessionConfig;

const logger = createLogger("SpriteWebsocketSession.ts");

/**
 * Websocket session client compatible with cloudflare workers api.
 * The @fly/sprites package is designed for node js, which uses an incompatible websocket API.
 */
export class SpriteWebsocketSession {
    private ws: WebSocket | null = null;
    private readonly spriteName: string;
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly config: WorkersSessionConfig;
    private ttyMode: boolean;
    private waitingForSessionInfo: boolean;
    private sessionInfoPromise: Promise<void> | null = null;
    private resolveSessionInfo: (() => void) | null = null;
    private rejectSessionInfo: ((error: Error) => void) | null = null;
    private sessionInfoTimeout: ReturnType<typeof setTimeout> | null = null;
  
    private stdoutHandlers: Set<(data: string) => void> = new Set();
    private stderrHandlers: Set<(data: string) => void> = new Set();
    private exitHandlers: Set<(code: number) => void> = new Set();
    private errorHandlers: Set<(error: Error) => void> = new Set();
    private serverMessageHandlers: Set<(msg: SpriteServerMessage) => void> = new Set();
  
    constructor(
      spriteName: string,
      apiKey: string,
      baseUrl: string,
      config: WorkersSessionConfig,
    ) {
      this.spriteName = spriteName;
      this.apiKey = apiKey;
      this.baseUrl = baseUrl;
      this.config = config;
      this.ttyMode = config.mode === "exec" ? Boolean(config.options.tty) : false; // on attach we cant force tty mode
      this.waitingForSessionInfo = config.mode === "attach";
      if (this.waitingForSessionInfo) {
        this.sessionInfoPromise = new Promise((resolve, reject) => {
          this.resolveSessionInfo = resolve;
          this.rejectSessionInfo = reject;
        });
      }
    }
  
    async start(): Promise<void> {
      const wsUrl = this.createWsUrl();

      wsUrl.searchParams.set("stdin", "true");
  
      if (this.config.options.env) {
        for (const [key, value] of Object.entries(this.config.options.env)) {
          wsUrl.searchParams.append("env", `${key}=${value}`);
        }
      }

      if (this.config.options.detachable) {
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
        logger.error(
          `WebSocket upgrade failed. Status: ${response.status}, Body: ${body}`,
        );
        throw new Error(
          `Server didn't accept WebSocket connection: ${response.status} - ${body}`
        );
      }
  
      // Accept the WebSocket connection to handle it in JS
      ws.accept();
      this.ws = ws;
  
      ws.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });
  
      ws.addEventListener("close", () => {
        this.rejectWaitingForSessionInfo(
          new Error("WebSocket closed before session_info"),
        );
        this.clearSessionInfoState();
        this.ws = null;
      });
  
      ws.addEventListener("error", () => {
        const error = new Error("WebSocket error");
        this.rejectWaitingForSessionInfo(error);
        this.errorHandlers.forEach((h) => h(error));
      });

      if (this.waitingForSessionInfo && this.sessionInfoPromise) {
        this.sessionInfoTimeout = setTimeout(() => {
          this.rejectWaitingForSessionInfo(new Error("Timeout waiting for session_info"));
        }, 10_000);
        await this.sessionInfoPromise;
      }
    }

    private createWsUrl(): URL {
      switch (this.config.mode) {
        case "exec": {
          const wsUrl = new URL(`${this.baseUrl}/v1/sprites/${this.spriteName}/exec`);
          wsUrl.searchParams.append("cmd", this.config.command);
          for (const arg of this.config.args) {
            wsUrl.searchParams.append("cmd", arg);
          }
          wsUrl.searchParams.set("path", this.config.command);

          if (this.config.options.cwd) {
            wsUrl.searchParams.set("dir", this.config.options.cwd);
          }

          if (this.config.options.tty) {
            wsUrl.searchParams.set("tty", "true");
            if (typeof this.config.options.cols === "number") {
              wsUrl.searchParams.set("cols", String(this.config.options.cols));
            }
            if (typeof this.config.options.rows === "number") {
              wsUrl.searchParams.set("rows", String(this.config.options.rows));
            }
          }

          return wsUrl;
        }
        case "attach": {
          const wsUrl = new URL(
            `${this.baseUrl}/v1/sprites/${this.spriteName}/exec/${this.config.sessionId}`,
          );

          if (this.config.options.cwd) {
            wsUrl.searchParams.set("dir", this.config.options.cwd);
          }

          return wsUrl;
        }
      }
    }
  
    private handleMessage(data: unknown): void {
      // Workers runtime quirk: ArrayBuffer comes as typeof "object" but instanceof ArrayBuffer may be false
      const isBinary = data instanceof ArrayBuffer ||
        (typeof data === "object" && data !== null && "byteLength" in data);

      if (this.waitingForSessionInfo) {
        this.handleAttachSessionInfo(data, isBinary);
        return;
      }
  
      if (this.ttyMode) {
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
        if (isBinary) {
          const buffer = data as ArrayBuffer;
          const view = new DataView(buffer);
          const streamId = view.getUint8(0);
          const payload = new Uint8Array(buffer, 1);
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

    private handleAttachSessionInfo(data: unknown, isBinary: boolean): void {
      if (isBinary || typeof data !== "string") {
        return;
      }

      try {
        const message: unknown = JSON.parse(data);
        const sessionInfoResult = SessionInfoMessageSchema.safeParse(message);
        if (sessionInfoResult.success) {
          const resolveSessionInfo = this.resolveSessionInfo;
          this.ttyMode = sessionInfoResult.data.tty;
          this.waitingForSessionInfo = false;
          this.clearSessionInfoState();
          this.dispatchServerMessage(sessionInfoResult.data);
          resolveSessionInfo?.();
          return;
        }

        this.dispatchServerMessage(message);
      } catch {
        // Ignore non-JSON messages until the server tells us how to decode the stream.
      }
    }

    private clearSessionInfoState(): void {
      if (this.sessionInfoTimeout) {
        clearTimeout(this.sessionInfoTimeout);
        this.sessionInfoTimeout = null;
      }
      this.resolveSessionInfo = null;
      this.rejectSessionInfo = null;
      this.sessionInfoPromise = null;
    }

    private rejectWaitingForSessionInfo(error: Error): void {
      if (!this.waitingForSessionInfo || !this.rejectSessionInfo) {
        return;
      }
      const rejectSessionInfo = this.rejectSessionInfo;
      this.waitingForSessionInfo = false;
      this.clearSessionInfoState();
      rejectSessionInfo(error);
    }
  
    private dispatchServerMessage(msg: unknown): void {
      const result = SpriteServerMessageSchema.safeParse(msg);
      if (!result.success) {
        logger.warn(
          `[SpriteWebsocketSession] Unknown server message: ${JSON.stringify(msg)} ${JSON.stringify(result.error.format())}`,
        );
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

      if (this.ttyMode) {
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

      if (this.ttyMode) {
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
      if (!this.ttyMode) throw new Error("Resize only supported in TTY mode");

      this.ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }

    signal(signal: string): void {
      if (!this.ws) throw new Error("WebSocket not connected");
      this.ws.send(JSON.stringify({ type: "signal", signal }));
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
      return this.ws !== null && this.ws.readyState === WebSocket.READY_STATE_OPEN;
    }
  }
  
