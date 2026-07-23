import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkersSpriteClient } from "../../src/shared/integrations/sprites/WorkersSpriteClient";
import { SpritesError } from "../../src/shared/integrations/sprites/types";

const encoder = new TextEncoder();

describe("WorkersSpriteClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams WebSocket exec chunks while returning accumulated output", async () => {
    const client = new WorkersSpriteClient(
      "sprite-1",
      "sprites-key",
      "https://api.sprites.test",
    );
    let stdoutHandler: ((data: string) => void) | null = null;
    let stderrHandler: ((data: string) => void) | null = null;
    const session = {
      onStdout: vi.fn((handler: (data: string) => void) => {
        stdoutHandler = handler;
      }),
      onStderr: vi.fn((handler: (data: string) => void) => {
        stderrHandler = handler;
      }),
      start: vi.fn(async () => {
        stdoutHandler?.("hello ");
        stderrHandler?.("warn\n");
        stdoutHandler?.("world\n");
      }),
      wait: vi.fn(async () => 0),
    };
    vi.spyOn(client, "createSession").mockReturnValue(
      session as unknown as ReturnType<WorkersSpriteClient["createSession"]>,
    );
    const onStdout = vi.fn();
    const onStderr = vi.fn();

    const result = await client.execWs("echo hello", {
      cwd: "/workspace",
      env: { FOO: "bar" },
      idleTimeoutMs: 123,
      onStdout,
      onStderr,
    });

    expect(client.createSession).toHaveBeenCalledWith("sh", ["-c", "echo hello"], {
      env: { FOO: "bar" },
      cwd: "/workspace",
      idleTimeoutMs: 123,
      tty: false,
      stdin: false,
    });
    expect(onStdout).toHaveBeenNthCalledWith(1, "hello ");
    expect(onStdout).toHaveBeenNthCalledWith(2, "world\n");
    expect(onStderr).toHaveBeenCalledWith("warn\n");
    expect(result).toEqual({
      stdout: "hello world",
      stderr: "warn",
      exitCode: 0,
    });
  });

  it("returns a nonzero WebSocket exit code with separate stdout and stderr", async () => {
    const webSocket = new FakeWebSocket([
      createFrame(1, "out\n"),
      createFrame(2, "err\n"),
      new Uint8Array([3, 7]),
    ]);
    vi.stubGlobal("WebSocket", { OPEN: FakeWebSocket.OPEN });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 101,
      webSocket,
    })) as unknown as typeof fetch);
    const client = new WorkersSpriteClient(
      "sprite-1",
      "sprites-key",
      "https://api.sprites.test",
    );

    await expect(client.execWs("exit 7")).resolves.toEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 7,
    });
  });

  it("rejects when the WebSocket closes before an exit frame", async () => {
    const webSocket = new FakeWebSocket([
      createFrame(1, "incomplete\n"),
    ], { closeBeforeExit: true });
    vi.stubGlobal("WebSocket", { OPEN: FakeWebSocket.OPEN });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 101,
      webSocket,
    })) as unknown as typeof fetch);
    const client = new WorkersSpriteClient(
      "sprite-1",
      "sprites-key",
      "https://api.sprites.test",
    );

    await expect(client.execWs("echo incomplete")).rejects.toThrow(
      "WebSocket closed before receiving process exit",
    );
  });
});

describe("WorkersSpriteClient HTTP endpoints", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const newClient = () =>
    new WorkersSpriteClient("sprite-1", "sprites-key", "https://api.sprites.test");

  it("posts network policy rules", async () => {
    const fetchMock = stubFetch();
    const rules = [{ domain: "example.com", action: "allow" as const }];

    await newClient().setNetworkPolicy(rules);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sprites.test/v1/sprites/sprite-1/policy/network",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer sprites-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rules }),
      },
    );
  });

  it("wraps a failed network policy update in SpritesError", async () => {
    stubFetch({ ok: false, status: 403, text: async () => "denied" });

    const error = await newClient()
      .setNetworkPolicy([])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SpritesError);
    expect((error as SpritesError).statusCode).toBe(403);
    expect((error as SpritesError).responseBody).toBe("denied");
  });

  it("kills a session with the default SIGTERM signal", async () => {
    const fetchMock = stubFetch();

    await newClient().killSession(42);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sprites.test/v1/sprites/sprite-1/exec/42/kill?signal=SIGTERM",
      {
        method: "POST",
        headers: { Authorization: "Bearer sprites-key" },
      },
    );
  });

  it("kills a session with an explicit signal and surfaces failures", async () => {
    const fetchMock = stubFetch({ ok: false, status: 404, text: async () => "gone" });

    const error = await newClient()
      .killSession(42, "SIGINT")
      .catch((caught: unknown) => caught);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.sprites.test/v1/sprites/sprite-1/exec/42/kill?signal=SIGINT",
    );
    expect(error).toBeInstanceOf(SpritesError);
    expect((error as SpritesError).statusCode).toBe(404);
  });

  it("writes a file with mkdir enabled by default", async () => {
    const fetchMock = stubFetch();

    await newClient().writeFile("/workspace/a.txt", "content", { mode: "0644" });

    const [urlString, init] = fetchMock.mock.calls[0]!;
    const url = new URL(urlString as string);
    expect(url.pathname).toBe("/v1/sprites/sprite-1/fs/write");
    expect(url.searchParams.get("path")).toBe("/workspace/a.txt");
    expect(url.searchParams.get("mkdir")).toBe("true");
    expect(url.searchParams.get("mode")).toBe("0644");
    expect(init).toEqual({
      method: "PUT",
      headers: {
        Authorization: "Bearer sprites-key",
        "Content-Type": "application/octet-stream",
      },
      body: "content",
    });
  });

  it("omits the mkdir param when mkdir is disabled", async () => {
    const fetchMock = stubFetch();

    await newClient().writeFile("/workspace/a.txt", "content", { mkdir: false });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("mkdir")).toBeNull();
    expect(url.searchParams.get("mode")).toBeNull();
  });

  it("returns sprite info from the REST API", async () => {
    const info = {
      name: "sprite-1",
      url: "https://sprite-1.sprites.app",
      url_settings: { auth: "sprite" },
      status: "running",
    };
    const fetchMock = stubFetch({ json: async () => info });

    await expect(newClient().getSpriteInfo()).resolves.toEqual(info);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sprites.test/v1/sprites/sprite-1",
      {
        method: "GET",
        headers: { Authorization: "Bearer sprites-key" },
      },
    );
  });

  it("wraps a failed sprite info request in SpritesError", async () => {
    stubFetch({ ok: false, status: 500, text: async () => "oops" });

    await expect(newClient().getSpriteInfo()).rejects.toThrow(
      "Failed to get sprite info: 500",
    );
  });

  it("updates URL auth settings", async () => {
    const fetchMock = stubFetch();

    await newClient().setUrlAuth("public");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.sprites.test/v1/sprites/sprite-1",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer sprites-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url_settings: { auth: "public" } }),
      },
    );
  });

  it("wraps a failed URL auth update in SpritesError", async () => {
    stubFetch({ ok: false, status: 400, text: async () => "bad request" });

    await expect(newClient().setUrlAuth("sprite")).rejects.toThrow(
      "Failed to update URL settings: 400",
    );
  });
});

function stubFetch(
  overrides: Partial<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  }> = {},
) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({}),
    ...overrides,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function createFrame(streamId: number, payload: string): Uint8Array {
  const payloadBytes = encoder.encode(payload);
  const frame = new Uint8Array(payloadBytes.length + 1);
  frame[0] = streamId;
  frame.set(payloadBytes, 1);
  return frame;
}

class FakeWebSocket {
  static readonly OPEN = 1;

  readyState = FakeWebSocket.OPEN;
  private readonly closeBeforeExit: boolean;
  private readonly frames: Uint8Array[];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(frames: Uint8Array[], options: { closeBeforeExit?: boolean } = {}) {
    this.frames = frames;
    this.closeBeforeExit = options.closeBeforeExit ?? false;
  }

  accept(): void {
    queueMicrotask(() => {
      for (const frame of this.frames) {
        this.dispatch("message", { data: frame });
      }
      if (this.closeBeforeExit) {
        this.close(1006);
      }
    });
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close(code = 1000): void {
    this.readyState = 3;
    this.dispatch("close", { code, reason: "" });
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}
