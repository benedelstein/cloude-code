import { SessionOptions, SpriteServerMessage, SpriteServerMessageSchema } from "./types";
import { createLogger } from "@/lib/logger";

/** Options for attaching to an existing detachable session */
interface AttachOptions extends SessionOptions {
    sessionId: string;
}

/** Internal discriminated config for the two transport modes */
type SessionMode =
    | { kind: "exec"; command: string; args: string[]; options: SessionOptions }
    | { kind: "attach"; options: AttachOptions };

const logger = createLogger("SpriteWebsocketSession");

/**
 * WebSocket session client compatible with Cloudflare Workers fetch-upgrade API.
 *
 * Two transport modes:
 *  - "exec": raw command execution (used for the long-lived vm-agent process)
 *  - "attach": attach to an existing detachable tmux session using
 *    upstream /exec/{sessionId} path semantics
 */
export class SpriteWebsocketSession {
    private ws: WebSocket | null = null;
    private spriteName: string;
    private apiKey: string;
    private baseUrl: string;
    private mode: SessionMode;

    /** Whether we are waiting for session_info before decoding binary frames */
    private waitingForSessionInfo: boolean = false;
    /** Resolved TTY mode (may be overridden by session_info on attach) */
    private ttyMode: boolean;

    private stdoutHandlers: Set<(data: string) => void> = new Set();
    private stderrHandlers: Set<(data: string) => void> = new Set();
    private exitHandlers: Set<(code: number) => void> = new Set();
    private errorHandlers: Set<(error: Error) => void> = new Set();
    private serverMessageHandlers: Set<(msg: SpriteServerMessage) => void> = new Set();

    private constructor(
        spriteName: string,
        apiKey: string,
        baseUrl: string,
        mode: SessionMode,
    ) {
        this.spriteName = spriteName;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.mode = mode;
        // Default TTY from options; attach mode overrides after session_info
        this.ttyMode = mode.kind === "exec"
            ? mode.options.tty ?? false
            : mode.options.tty ?? false;
    }

    /**
     * Create a raw exec WebSocket session for running a command.
     * Used for long-lived processes like the vm-agent.
     */
    static createExec(
        spriteName: string,
        apiKey: string,
        baseUrl: string,
        command: string,
        args: string[],
        options: SessionOptions = {},
    ): SpriteWebsocketSession {
        return new SpriteWebsocketSession(spriteName, apiKey, baseUrl, {
            kind: "exec",
            command,
            args,
            options,
        });
    }

    /**
     * Create an attach WebSocket session for reconnecting to a detachable session.
     * Uses upstream /exec/{sessionId} path and waits for session_info.
     */
    static createAttach(
        spriteName: string,
        apiKey: string,
        baseUrl: string,
        sessionId: string,
        options: SessionOptions = {},
    ): SpriteWebsocketSession {
        return new SpriteWebsocketSession(spriteName, apiKey, baseUrl, {
            kind: "attach",
            options: { ...options, sessionId },
        });
    }

    async start(): Promise<void> {
        const wsUrl = this.buildUrl();

        // Sanitized connection log (no env values)
        const options = this.mode.kind === "exec" ? this.mode.options : this.mode.options;
        logger.info("Connecting WebSocket", {
            fields: {
                mode: this.mode.kind,
                spriteName: this.spriteName,
                tty: this.ttyMode,
                stdin: true,
                hasDir: !!options.cwd,
                envCount: options.env ? Object.keys(options.env).length : 0,
                urlLength: wsUrl.toString().length,
                ...(this.mode.kind === "attach" && { sessionId: this.mode.options.sessionId }),
            },
        });

        const response = await fetch(wsUrl.toString(), {
            headers: {
                Upgrade: "websocket",
                Authorization: `Bearer ${this.apiKey}`,
            },
        });

        const ws = response.webSocket;
        if (!ws) {
            const body = await response.text();
            logger.error("WebSocket upgrade failed", {
                fields: {
                    status: response.status,
                    mode: this.mode.kind,
                    spriteName: this.spriteName,
                    body,
                },
            });
            throw new Error(
                `Server didn't accept WebSocket connection: ${response.status} - ${body}`
            );
        }

        ws.accept();
        this.ws = ws;

        // In attach mode, wait for session_info before processing binary frames.
        // session_info tells us the actual TTY mode of the existing session.
        if (this.mode.kind === "attach") {
            this.waitingForSessionInfo = true;
        }

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

    /**
     * Build the WebSocket URL based on mode.
     *
     * exec mode:   /v1/sprites/{name}/exec  + cmd, path, env, dir, tty, rows, cols, detachable, stdin
     * attach mode: /v1/sprites/{name}/exec/{sessionId}  + stdin only (no cmd/path/tty)
     */
    private buildUrl(): URL {
        if (this.mode.kind === "attach") {
            const url = new URL(
                `${this.baseUrl}/v1/sprites/${this.spriteName}/exec/${this.mode.options.sessionId}`
            );
            url.searchParams.set("stdin", "true");
            return url;
        }

        // exec mode
        const { command, args, options } = this.mode;
        const url = new URL(`${this.baseUrl}/v1/sprites/${this.spriteName}/exec`);

        if (command) {
            url.searchParams.append("cmd", command);
            for (const arg of args) {
                url.searchParams.append("cmd", arg);
            }
            url.searchParams.set("path", command);
        }

        url.searchParams.set("stdin", "true");

        if (options.env) {
            for (const [key, value] of Object.entries(options.env)) {
                url.searchParams.append("env", `${key}=${value}`);
            }
        }

        if (options.cwd) {
            url.searchParams.set("dir", options.cwd);
        }

        if (options.tty) {
            url.searchParams.set("tty", "true");
            if (options.rows) {
                url.searchParams.set("rows", options.rows.toString());
            }
            if (options.cols) {
                url.searchParams.set("cols", options.cols.toString());
            }
        }

        if (options.detachable) {
            url.searchParams.set("detachable", "true");
        }

        return url;
    }

    private handleMessage(data: unknown): void {
        const isBinary = data instanceof ArrayBuffer ||
            (typeof data === "object" && data !== null && "byteLength" in data);

        // While waiting for session_info (attach mode), only process text JSON messages.
        // Binary frames during this phase are historical output replay — ignore them.
        if (this.waitingForSessionInfo) {
            if (typeof data === "string") {
                try {
                    const msg: unknown = JSON.parse(data);
                    if (typeof msg === "object" && msg !== null && "type" in msg) {
                        const typed = msg as Record<string, unknown>;
                        if (typed.type === "session_info") {
                            this.waitingForSessionInfo = false;
                            // Auto-detect TTY mode from the existing session
                            if (typeof typed.tty === "boolean") {
                                this.ttyMode = typed.tty;
                            }
                        }
                    }
                    this.dispatchServerMessage(msg);
                } catch {
                    // Non-JSON during session_info wait — ignore
                }
            }
            // Ignore binary during session_info wait
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
                    // Non-JSON string — treat as stdout
                    this.stdoutHandlers.forEach((h) => h(data));
                }
            }
        } else {
            // Non-TTY mode: stream-based binary protocol
            if (data instanceof ArrayBuffer) {
                const view = new DataView(data);
                if (data.byteLength === 0) return;

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
                    // Non-JSON string — unexpected in non-TTY mode
                }
            }
        }
    }

    private dispatchServerMessage(msg: unknown): void {
        const result = SpriteServerMessageSchema.safeParse(msg);
        if (!result.success) {
            logger.warn(
                `Unknown server message: ${JSON.stringify(msg)} ${JSON.stringify(result.error.format())}`,
            );
            return;
        }

        const parsed = result.data;
        this.serverMessageHandlers.forEach((h) => h(parsed));

        // Also dispatch to exitHandlers for backwards compatibility
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

    signal(sig: string): void {
        if (!this.ws) throw new Error("WebSocket not connected");

        this.ws.send(JSON.stringify({ type: "signal", signal: sig }));
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
