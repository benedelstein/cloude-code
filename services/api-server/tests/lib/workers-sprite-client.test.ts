import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkersSpriteClient } from "../../src/shared/integrations/sprites/WorkersSpriteClient";

const encoder = new TextEncoder();

describe("WorkersSpriteClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses an exit marker after trailing blank stdout lines", async () => {
    const body = concatBytes(
      new Uint8Array([0x01]),
      encoder.encode("build complete\n\n"),
      new Uint8Array([0x03, 0x00]),
    );
    const fetchMock = vi.fn(async () => new Response(body, {
      headers: { "content-type": "application/octet-stream" },
      status: 200,
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

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
