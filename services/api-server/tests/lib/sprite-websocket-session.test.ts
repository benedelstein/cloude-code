import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SpriteWebsocketSession,
  StreamID,
} from "../../src/shared/integrations/sprites/SpriteWebsocketSession";

const encoder = new TextEncoder();

describe("SpriteWebsocketSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("exec mode connection", () => {
    it("connects with command, args, auth header, and default stdin", async () => {
      const { session, ws, fetchMock } = createExecSession("echo", ["hello"]);

      await session.start();

      expect(ws.accepted).toBe(true);
      const [urlString, init] = fetchMock.mock.calls[0]!;
      const url = new URL(urlString as string);
      expect(url.pathname).toBe("/v1/sprites/sprite-1/exec");
      expect(url.searchParams.getAll("cmd")).toEqual(["echo", "hello"]);
      expect(url.searchParams.get("path")).toBe("echo");
      expect(url.searchParams.get("stdin")).toBe("true");
      expect(url.searchParams.get("tty")).toBeNull();
      expect((init as RequestInit).headers).toEqual({
        Upgrade: "websocket",
        Authorization: "Bearer sprites-key",
      });
    });

    it("encodes cwd, env, tty dimensions, detachable, and disconnect grace in the URL", async () => {
      const { session, fetchMock } = createExecSession("bash", [], {
        cwd: "/workspace",
        env: { FOO: "bar", BAZ: "qux" },
        tty: true,
        cols: 80,
        rows: 24,
        stdin: false,
        detachable: true,
        maxRunAfterDisconnect: "60s",
      });

      await session.start();

      const url = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(url.searchParams.get("dir")).toBe("/workspace");
      expect(url.searchParams.getAll("env")).toEqual(["FOO=bar", "BAZ=qux"]);
      expect(url.searchParams.get("tty")).toBe("true");
      expect(url.searchParams.get("cols")).toBe("80");
      expect(url.searchParams.get("rows")).toBe("24");
      expect(url.searchParams.get("stdin")).toBeNull();
      expect(url.searchParams.get("detachable")).toBe("true");
      expect(url.searchParams.get("max_run_after_disconnect")).toBe("60s");
    });

    it("throws when the server does not accept the WebSocket upgrade", async () => {
      stubUpgradeFailure(502, "bad gateway");
      const session = newSession({
        mode: "exec",
        command: "echo",
        args: [],
        options: {},
      });

      await expect(session.start()).rejects.toThrow(
        "Server didn't accept WebSocket connection: 502 - bad gateway",
      );
    });

    it("cannot be started twice", async () => {
      const { session } = createExecSession("echo", []);

      await session.start();

      await expect(session.start()).rejects.toThrow(
        "SpriteWebsocketSession already started",
      );
    });
  });

  describe("non-TTY stream protocol", () => {
    it("routes stdout, stderr, and exit frames to their handlers", async () => {
      const { session, ws } = createExecSession("echo", []);
      const stdout: string[] = [];
      const stderr: string[] = [];
      const onExit = vi.fn();
      session.onStdout((data) => stdout.push(data));
      session.onStderr((data) => stderr.push(data));
      session.onExit(onExit);
      await session.start();

      ws.emitMessage(frame(StreamID.Stdout, "out\n"));
      ws.emitMessage(frame(StreamID.Stderr, "err\n"));
      ws.emitMessage(new Uint8Array(0));
      ws.emitMessage(new Uint8Array([StreamID.Exit, 7]));

      expect(stdout).toEqual(["out\n"]);
      expect(stderr).toEqual(["err\n"]);
      expect(onExit).toHaveBeenCalledWith(7);
      expect(session.isDone).toBe(true);
      await expect(session.wait()).resolves.toBe(7);
    });

    it("treats an exit frame without a payload as exit code 0", async () => {
      const { session, ws } = createExecSession("echo", []);
      await session.start();

      ws.emitMessage(new Uint8Array([StreamID.Exit]));

      await expect(session.wait()).resolves.toBe(0);
    });

    it("stitches multi-byte UTF-8 sequences split across frames", async () => {
      const { session, ws } = createExecSession("echo", []);
      let stdout = "";
      session.onStdout((data) => {
        stdout += data;
      });
      await session.start();

      // "é" is 0xC3 0xA9; split it across two stdout frames
      ws.emitMessage(new Uint8Array([StreamID.Stdout, 0xc3]));
      ws.emitMessage(new Uint8Array([StreamID.Stdout, 0xa9]));

      expect(stdout).toBe("é");
    });

    it("resolves wait via a JSON exit message and ignores a duplicate exit frame", async () => {
      const { session, ws } = createExecSession("echo", []);
      const onExit = vi.fn();
      session.onExit(onExit);
      await session.start();
      const waitPromise = session.wait();

      ws.emitMessage(JSON.stringify({ type: "exit", exit_code: 3 }));
      ws.emitMessage(new Uint8Array([StreamID.Exit, 9]));

      await expect(waitPromise).resolves.toBe(3);
      expect(onExit).toHaveBeenCalledTimes(1);
      await expect(session.wait()).resolves.toBe(3);
    });

    it("dispatches known server messages and drops unknown ones", async () => {
      const { session, ws } = createExecSession("echo", []);
      const onServerMessage = vi.fn();
      session.onServerMessage(onServerMessage);
      await session.start();

      ws.emitMessage(
        JSON.stringify({
          type: "port_opened",
          port: 8080,
          address: "0.0.0.0",
          pid: 12,
        }),
      );
      ws.emitMessage(JSON.stringify({ type: "mystery" }));

      expect(onServerMessage).toHaveBeenCalledTimes(1);
      expect(onServerMessage).toHaveBeenCalledWith({
        type: "port_opened",
        port: 8080,
        address: "0.0.0.0",
        pid: 12,
      });
    });

    it("stops delivering to a handler after unsubscribing", async () => {
      const { session, ws } = createExecSession("echo", []);
      const onStdout = vi.fn();
      const unsubscribe = session.onStdout(onStdout);
      await session.start();

      unsubscribe();
      ws.emitMessage(frame(StreamID.Stdout, "after\n"));

      expect(onStdout).not.toHaveBeenCalled();
    });
  });

  describe("transport failures", () => {
    it("notifies onError and rejects waiters when the socket closes before exit", async () => {
      const { session, ws } = createExecSession("echo", []);
      const onError = vi.fn();
      session.onError(onError);
      await session.start();
      const waitPromise = session.wait();

      ws.emitClose(1006, "going away");

      await expect(waitPromise).rejects.toThrow(
        "WebSocket closed before receiving process exit: code=1006 reason=going away",
      );
      expect(onError).toHaveBeenCalledTimes(1);
      await expect(session.wait()).rejects.toThrow(
        "WebSocket closed before receiving process exit",
      );
    });

    it("fails the session when the socket errors mid-stream", async () => {
      const { session, ws } = createExecSession("echo", []);
      const onError = vi.fn();
      session.onError(onError);
      await session.start();
      const waitPromise = session.wait();

      ws.emitError("boom");

      await expect(waitPromise).rejects.toThrow("WebSocket error");
      expect(onError).toHaveBeenCalledTimes(1);
      expect(ws.closeCalls).toContain(1001);
    });

    it("times out when no output arrives within idleTimeoutMs, resetting on activity", async () => {
      vi.useFakeTimers();
      const { session, ws } = createExecSession("sleep", ["10"], {
        idleTimeoutMs: 500,
      });
      const onError = vi.fn();
      session.onError(onError);
      await session.start();
      const waitPromise = session.wait();
      waitPromise.catch(() => {});

      await vi.advanceTimersByTimeAsync(400);
      ws.emitMessage(frame(StreamID.Stdout, "tick"));
      await vi.advanceTimersByTimeAsync(400);
      expect(onError).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "WebSocket idle timeout after 500ms",
        }),
      );
      await expect(waitPromise).rejects.toThrow("WebSocket idle timeout");
    });
  });

  describe("stdin and control commands", () => {
    it("frames stdin writes and stdin EOF in non-TTY mode", async () => {
      const { session, ws } = createExecSession("cat", []);
      await session.start();

      session.write("hi");
      session.closeStdin();

      expect(ws.sent).toEqual([
        bytes([StreamID.Stdin, ...encoder.encode("hi")]),
        bytes([StreamID.StdinEOF]),
      ]);
    });

    it("throws when writing before the socket is connected", () => {
      const session = newSession({
        mode: "exec",
        command: "cat",
        args: [],
        options: {},
      });

      expect(() => session.write("hi")).toThrow("WebSocket not connected");
    });

    it("rejects resize in non-TTY mode and sends signal messages as JSON", async () => {
      const { session, ws } = createExecSession("cat", []);
      await session.start();

      expect(() => session.resize(80, 24)).toThrow(
        "Resize only supported in TTY mode",
      );
      session.signal("SIGINT");

      expect(ws.sent).toEqual([
        JSON.stringify({ type: "signal", signal: "SIGINT" }),
      ]);
    });
  });

  describe("TTY mode", () => {
    it("treats binary payloads as raw stdout and JSON strings as server messages", async () => {
      const { session, ws } = createExecSession("bash", [], { tty: true });
      const stdout: string[] = [];
      session.onStdout((data) => stdout.push(data));
      await session.start();

      ws.emitMessage(encoder.encode("prompt$ "));
      ws.emitMessage(JSON.stringify({ type: "exit", exit_code: 0 }));
      expect(session.isTTY).toBe(true);
      expect(stdout).toEqual(["prompt$ "]);
      await expect(session.wait()).resolves.toBe(0);
    });

    it("treats non-JSON strings as stdout", async () => {
      const { session, ws } = createExecSession("bash", [], { tty: true });
      const stdout: string[] = [];
      session.onStdout((data) => stdout.push(data));
      await session.start();

      ws.emitMessage("plain text");

      expect(stdout).toEqual(["plain text"]);
    });

    it("sends raw stdin, Ctrl+D for EOF, and resize control messages", async () => {
      const { session, ws } = createExecSession("bash", [], { tty: true });
      await session.start();

      session.write("ls\n");
      session.closeStdin();
      session.resize(120, 40);

      expect(ws.sent).toEqual([
        bytes([...encoder.encode("ls\n")]),
        bytes([...encoder.encode("\x04")]),
        JSON.stringify({ type: "resize", cols: 120, rows: 40 }),
      ]);
    });
  });

  describe("attach mode", () => {
    it("waits for session_info, adopts its TTY mode, and forwards it to handlers", async () => {
      const { session, ws, fetchMock } = createAttachSession("sess-42");
      const onServerMessage = vi.fn();
      const stdout: string[] = [];
      session.onServerMessage(onServerMessage);
      session.onStdout((data) => stdout.push(data));

      const startPromise = session.start();
      await flushMicrotasks();
      const sessionInfo = {
        type: "session_info",
        session_id: 42,
        command: "bash",
        created: 123,
        is_owner: true,
        tty: true,
      };
      ws.emitMessage(JSON.stringify(sessionInfo));
      await startPromise;
      ws.emitMessage(encoder.encode("attached$ "));

      const url = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(url.pathname).toBe("/v1/sprites/sprite-1/exec/sess-42");
      expect(session.isTTY).toBe(true);
      expect(onServerMessage).toHaveBeenCalledWith(sessionInfo);
      expect(stdout).toEqual(["attached$ "]);
    });

    it("times out when session_info never arrives", async () => {
      vi.useFakeTimers();
      const { session } = createAttachSession("sess-42");

      const startPromise = session.start();
      const settled = startPromise.catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(await settled).toEqual(
        new Error("Timeout waiting for session_info"),
      );
    });

    it("rejects when the socket closes before session_info", async () => {
      const { session, ws } = createAttachSession("sess-42");

      const startPromise = session.start();
      const settled = startPromise.catch((error: Error) => error);
      await flushMicrotasks();
      ws.emitClose(1006);

      expect(await settled).toEqual(
        new Error("WebSocket closed before session_info"),
      );
    });
  });
});

// =============================================================================
// Helpers
// =============================================================================

type SessionConfig = ConstructorParameters<typeof SpriteWebsocketSession>[3];

function newSession(config: SessionConfig): SpriteWebsocketSession {
  return new SpriteWebsocketSession(
    "sprite-1",
    "sprites-key",
    "https://api.sprites.test",
    config,
  );
}

function stubUpgrade(ws: FakeWorkersWebSocket) {
  const fetchMock = vi.fn(async () => ({ status: 101, webSocket: ws }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", { OPEN: FakeWorkersWebSocket.OPEN });
  return fetchMock;
}

function stubUpgradeFailure(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      webSocket: null,
      text: async () => body,
    })),
  );
  vi.stubGlobal("WebSocket", { OPEN: FakeWorkersWebSocket.OPEN });
}

function createExecSession(
  command: string,
  args: string[],
  options: Record<string, unknown> = {},
) {
  const ws = new FakeWorkersWebSocket();
  const fetchMock = stubUpgrade(ws);
  const session = newSession({ mode: "exec", command, args, options });
  return { session, ws, fetchMock };
}

function createAttachSession(sessionId: string) {
  const ws = new FakeWorkersWebSocket();
  const fetchMock = stubUpgrade(ws);
  const session = newSession({ mode: "attach", sessionId, options: {} });
  return { session, ws, fetchMock };
}

function frame(streamId: number, payload: string): Uint8Array {
  const payloadBytes = encoder.encode(payload);
  const out = new Uint8Array(payloadBytes.length + 1);
  out[0] = streamId;
  out.set(payloadBytes, 1);
  return out;
}

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeWorkersWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeWorkersWebSocket.OPEN;
  accepted = false;
  readonly sent: Array<string | Uint8Array> = [];
  readonly closeCalls: number[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  accept(): void {
    this.accepted = true;
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closeCalls.push(code);
    this.readyState = FakeWorkersWebSocket.CLOSED;
    this.dispatch("close", { code, reason: "" });
  }

  emitMessage(data: string | Uint8Array): void {
    this.dispatch("message", { data });
  }

  emitClose(code: number, reason = ""): void {
    this.readyState = FakeWorkersWebSocket.CLOSED;
    this.dispatch("close", { code, reason });
  }

  emitError(message: string): void {
    this.dispatch("error", { message });
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}
