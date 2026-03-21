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

/**
 * Stream ID for the binary protocol
 */
export enum StreamID {
  Stdin = 0,
  Stdout = 1,
  Stderr = 2,
  Exit = 3,
  StdinEOF = 4,
}

type WorkersSessionConfig = NewExecSessionConfig | AttachSessionConfig;

const logger = createLogger("SpriteWebsocketSession.ts");

const KEEPALIVE_INTERVAL_MS = 15_000;
const KEEPALIVE_TIMEOUT_MS = 45_000;

const WEBSOCKET_CLOSED_OK_CODE = 1000;
const WEBSOCKET_CLOSED_GOING_AWAY_CODE = 1001;

/**
 * Websocket session client compatible with cloudflare workers api.
 * The @fly/sprites package is designed for node js, which uses an incompatible websocket API.
 */
export class SpriteWebsocketSession {
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();
  private ws: WebSocket | null = null;
  private readonly spriteName: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly config: WorkersSessionConfig;
  private ttyMode: boolean;
  private exitCode: number | null = null;
  private started = false;
  private done = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastActivityTime = 0;
  private terminalError: Error | null = null;
  private readonly pendingWaiters = new Set<{
    resolve: (code: number) => void;
    reject: (error: Error) => void;
  }>();

  private stdoutHandlers: Set<(data: string) => void> = new Set();
  private stderrHandlers: Set<(data: string) => void> = new Set();
  private exitHandlers: Set<(code: number) => void> = new Set();
  private errorHandlers: Set<(error: Error) => void> = new Set();
  private serverMessageHandlers: Set<(msg: SpriteServerMessage) => void> =
    new Set();

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
    this.ttyMode = config.mode === "exec" ? Boolean(config.options.tty) : false;
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error("SpriteWebsocketSession already started");
    }
    this.started = true;

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
        `Server didn't accept WebSocket connection: ${response.status} - ${body}`,
      );
    }

    // Accept the WebSocket connection to handle it in JS
    ws.accept();
    this.ws = ws;

    // For attach mode, wait for session_info before setting up the main message handler.
    // We cannot decode binary data until we know the TTY mode.
    if (this.config.mode === "attach") {
      await this.waitForSessionInfo();
    }

    ws.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    // this signals that the websocket closed, not that the process on the vm finished.
    ws.addEventListener("close", (event) => {
      this.handleWSClose(event);
    });

    ws.addEventListener("error", (error) => {
      logger.error("WebSocket error", {
        error: error.message,
      });
      this.finalizeTransportFailure(new Error("WebSocket error"), {
        emitError: true,
        closeCode: WEBSOCKET_CLOSED_GOING_AWAY_CODE,
      });
    });

    this.startKeepalive();
  }

  /**
   * Waits for the session_info message when attaching to an existing session.
   * Uses a temporary self-removing listener so the main message handler is not
   * active until ttyMode is known. Binary messages (historical output) are
   * ignored since they cannot be decoded without knowing TTY mode.
   */
  private waitForSessionInfo(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.ws?.removeEventListener("message", messageHandler);
        this.ws?.removeEventListener("close", closeHandler);
        this.ws?.removeEventListener("error", errorHandler);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for session_info"));
      }, 10_000);

      const closeHandler = () => {
        cleanup();
        logger.error("WebSocket closed before session_info");
        reject(new Error("WebSocket closed before session_info"));
      };

      const errorHandler = () => {
        cleanup();
        logger.error("WebSocket error before session_info");
        reject(new Error("WebSocket error before session_info"));
      };

      const messageHandler = (event: MessageEvent) => {
        // Binary messages before session_info are historical output - ignore until TTY mode is known
        if (typeof event.data !== "string") return;
        try {
          const message: unknown = JSON.parse(event.data);
          const result = SessionInfoMessageSchema.safeParse(message);
          if (result.success) {
            cleanup();
            logger.info(`Session info received: ${result.data.tty ? "TTY" : "non-TTY"}`);
            this.ttyMode = result.data.tty;
            this.dispatchServerMessage(result.data);
            resolve();
            return;
          }
          // Forward non-session_info messages to server message handlers
          this.dispatchServerMessage(message);
        } catch {
          // Non-JSON - ignore during session_info wait
        }
      };

      this.ws!.addEventListener("message", messageHandler);
      this.ws!.addEventListener("close", closeHandler);
      this.ws!.addEventListener("error", errorHandler);
    });
  }

  private createWsUrl(): URL {
    switch (this.config.mode) {
      case "exec": {
        const wsUrl = new URL(
          `${this.baseUrl}/v1/sprites/${this.spriteName}/exec`,
        );
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

  private startKeepalive(): void {
    this.lastActivityTime = Date.now();
    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopKeepalive();
        return;
      }

      if (Date.now() - this.lastActivityTime > KEEPALIVE_TIMEOUT_MS) {
        logger.error("WebSocket keepalive timeout");
        this.finalizeTransportFailure(
          new Error("WebSocket keepalive timeout"),
          {
            emitError: true,
            closeCode: WEBSOCKET_CLOSED_GOING_AWAY_CODE,
          },
        );
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private resetKeepalive(): void {
    this.lastActivityTime = Date.now();
  }

  private getBinaryPayload(data: unknown): Uint8Array | null {
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }

    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }

    return null;
  }

  private getOpenWebSocket(): WebSocket {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    return this.ws;
  }

  private sendBinaryFrame(streamId: StreamID, payload?: Uint8Array): void {
    const framePayload = payload ?? new Uint8Array(0);
    const frame = new Uint8Array(1 + framePayload.length);
    frame[0] = streamId;
    frame.set(framePayload, 1);
    this.getOpenWebSocket().send(frame);
  }

  private handleMessage(data: unknown): void {
    if (this.done) {
      return;
    }

    this.resetKeepalive();
    const binaryPayload = this.getBinaryPayload(data);

    if (this.ttyMode) {
      // TTY mode: binary = raw stdout, string = JSON control messages
      if (binaryPayload) {
        const text = this.textDecoder.decode(binaryPayload);
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
      if (binaryPayload) {
        if (binaryPayload.length === 0) {
          return;
        }

        const streamId = binaryPayload[0];
        const payload = binaryPayload.subarray(1);
        const text = this.textDecoder.decode(payload);

        switch (streamId) {
          case StreamID.Stdout: // stdout
            this.stdoutHandlers.forEach((h) => h(text));
            break;
          case StreamID.Stderr: // stderr
            this.stderrHandlers.forEach((h) => h(text));
            break;
          case StreamID.Exit: {
            this.finalizeExit(payload.length > 0 ? payload[0]! : 0);
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

  /**
   * Handles websocket close
   * @param event
   */
  private handleWSClose(event: CloseEvent): void {
    this.stopKeepalive();
    this.ws = null;

    if (this.done) {
      return;
    }

    if (this.exitCode !== null) {
      this.done = true;
      this.resolvePendingWaits(this.exitCode);
      this.exitHandlers.forEach((handler) => handler(this.exitCode!));
      return;
    }

    const reasonSuffix = event.reason ? ` reason=${event.reason}` : "";
    this.finalizeTransportFailure(
      new Error(
        `WebSocket closed before receiving process exit: code=${event.code}${reasonSuffix}`,
      ),
      { emitError: false },
    );
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

    if (parsed.type === "exit") {
      this.finalizeExit(parsed.exit_code);
    }
  }

  private finalizeExit(exitCode: number): void {
    if (this.exitCode !== null) {
      if (this.exitCode !== exitCode) {
        logger.warn(
          `Ignoring duplicate exit code ${exitCode}; already recorded ${this.exitCode}`,
        );
      }
      return;
    }

    this.exitCode = exitCode;
  }

  private finalizeTransportFailure(
    error: Error,
    options: {
      emitError: boolean;
      closeCode?: number;
    },
  ): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.terminalError = error;
    this.stopKeepalive();

    if (options.emitError) {
      this.errorHandlers.forEach((handler) => handler(error));
    }

    this.rejectPendingWaits(error);

    if (typeof options.closeCode === "number") {
      this.close(options.closeCode);
    }
  }

  private resolvePendingWaits(exitCode: number): void {
    for (const waiter of this.pendingWaiters) {
      waiter.resolve(exitCode);
    }
    this.pendingWaiters.clear();
  }

  private rejectPendingWaits(error: Error): void {
    for (const waiter of this.pendingWaiters) {
      waiter.reject(error);
    }
    this.pendingWaiters.clear();
  }

  /**
   * Write data to stdin
   * @param data
   */
  write(data: string): void {
    const textBytes = this.textEncoder.encode(data);

    if (this.ttyMode) {
      // TTY mode: send raw text
      this.getOpenWebSocket().send(textBytes);
    } else {
      this.sendBinaryFrame(StreamID.Stdin, textBytes);
    }
  }

  closeStdin(): void {
    if (this.ttyMode) {
      // TTY mode: send Ctrl+D (EOT character)
      this.getOpenWebSocket().send(this.textEncoder.encode("\x04"));
    } else {
      this.sendBinaryFrame(StreamID.StdinEOF);
    }
  }

  //==========================================================================================================
  // Event handlers
  //==========================================================================================================

  /* eslint-disable no-unused-vars */
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

  // ==========================================================================================================
  // Public session commands
  // ==========================================================================================================

  wait(): Promise<number> {
    if (this.done) {
      if (this.exitCode !== null) {
        return Promise.resolve(this.exitCode);
      }
      return Promise.reject(
        this.terminalError ?? new Error("Session ended without an exit code"),
      );
    }

    return new Promise((resolve, reject) => {
      this.pendingWaiters.add({ resolve, reject });
    });
  }

  close(code: number = WEBSOCKET_CLOSED_OK_CODE): void {
    this.stopKeepalive();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(code, "");
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.ttyMode) throw new Error("Resize only supported in TTY mode");

    this.getOpenWebSocket().send(JSON.stringify({ type: "resize", cols, rows }));
  }

  signal(signal: string): void {
    this.getOpenWebSocket().send(JSON.stringify({ type: "signal", signal }));
  }

  get isConnected(): boolean {
    return this.ws !== null;
  }

  /**
   * Get the current TTY mode
   */
  get isTTY(): boolean {
    return this.ttyMode;
  }

  /**
   * Check if the command is done
   */
  get isDone(): boolean {
    return this.done;
  }
  /* eslint-enable no-unused-vars */
}
