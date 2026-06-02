import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkersSpriteClient } from "../../src/shared/integrations/sprites/WorkersSpriteClient";

const encoder = new TextEncoder();

describe("WorkersSpriteClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses an exit marker after trailing blank stdout lines", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createExecResponse(
      concatBytes(new Uint8Array([0x01]), encoder.encode("build complete\n\n")),
      new Uint8Array([0x03, 0x00]),
    )) as unknown as typeof fetch);

    const client = new WorkersSpriteClient(
      "sprite-1",
      "sprites-key",
      "https://api.sprites.test",
    );

    const result = await client.execHttp("echo ok");

    expect(result).toEqual({
      stdout: "build complete",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves multiline stdout in a single HTTP exec frame", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createExecResponse(
      concatBytes(new Uint8Array([0x01]), encoder.encode("one\ntwo\nthree\n")),
      new Uint8Array([0x03, 0x00]),
    )) as unknown as typeof fetch);

    const client = new WorkersSpriteClient(
      "sprite-1",
      "sprites-key",
      "https://api.sprites.test",
    );

    const result = await client.execHttp("printf lines");

    expect(result).toEqual({
      stdout: "one\ntwo\nthree",
      stderr: "",
      exitCode: 0,
    });
  });

  it("does not treat trailing payload bytes as an exit marker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createExecResponse(
      concatBytes(new Uint8Array([0x01]), encoder.encode("ok"), new Uint8Array([0x03, 0x2a])),
      new Uint8Array([0x03, 0x00]),
    )) as unknown as typeof fetch);

    const client = new WorkersSpriteClient(
      "sprite-1",
      "sprites-key",
      "https://api.sprites.test",
    );

    const result = await client.execHttp("printf marker bytes");

    expect(result).toEqual({
      stdout: "ok\u0003*",
      stderr: "",
      exitCode: 0,
    });
  });

  it("parses stdout and stderr from separate HTTP exec frames", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => createExecResponse(
      concatBytes(new Uint8Array([0x01]), encoder.encode("out\n")),
      concatBytes(new Uint8Array([0x02]), encoder.encode("err\n")),
      new Uint8Array([0x03, 0x07]),
    )) as unknown as typeof fetch);

    const client = new WorkersSpriteClient(
      "sprite-1",
      "sprites-key",
      "https://api.sprites.test",
    );

    const result = await client.execHttp("echo out; echo err >&2; exit 7");

    expect(result).toEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 7,
    });
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
});

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function createExecResponse(...frames: Uint8Array[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(frame);
      }
      controller.close();
    },
  }), {
    headers: { "content-type": "application/octet-stream" },
    status: 200,
  });
}
