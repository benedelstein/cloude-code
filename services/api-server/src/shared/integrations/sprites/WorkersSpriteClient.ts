import { SpriteWebsocketSession } from "./SpriteWebsocketSession";
import type {
  AttachSessionOptions,
  ExecResult,
  NewExecSessionOptions} from "./types";
import {
  SpritesError,
} from "./types";
import { createLogger } from "@/shared/logging";

export interface NetworkPolicyRule {
  domain: string;
  action: "allow" | "deny";
}

export interface SpriteUrlSettings {
  auth: "public" | "sprite";
}

export interface SpriteInfoResponse {
  name: string;
  url?: string;
  url_settings?: { auth: string };
  status?: string;
}

const logger = createLogger("WorkersSpriteClient.ts");

interface ResponseBodyRead {
  buffer: Uint8Array;
  chunkCount: number;
  lastChunkAtMs: number | null;
  readError?: string;
}

export class WorkersSpriteClient {
  private baseUrl: string;
  private apiKey: string;
  public readonly name: string;

  constructor(name: string, apiKey: string, baseUrl: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async execHttp(
    command: string,
    options: {
      tty?: boolean;
      env?: Record<string, string>;
      dir?: string;
    } = {},
  ): Promise<ExecResult> {
    const d0 = Date.now();
    const url = new URL(`${this.baseUrl}/v1/sprites/${this.name}/exec`);

    // Wrap command in sh -c to support shell syntax (pipes, redirects, etc.)
    url.searchParams.append("cmd", "sh");
    url.searchParams.append("cmd", "-c");
    url.searchParams.append("cmd", command);
    url.searchParams.set("path", "sh");

    if (options.tty) {
      url.searchParams.set("tty", "true");
    }
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        url.searchParams.append("env", `${key}=${value}`);
      }
    }
    if (options.dir) {
      url.searchParams.set("dir", options.dir);
    }

    // Sprites exec endpoint - POST for simple HTTP exec (non-TTY)
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    const fetchHeadersMs = Date.now() - d0;

    if (!response.ok) {
      const text = await response.text();
      logger.error("Exec failed", {
        fields: { responseBody: text },
      });
      throw new SpritesError(
        `Exec failed: ${response.status}`,
        response.status,
        text,
      );
    }

    // Sprites exec returns a binary stream with control byte prefixes:
    //   \x01 = stdout data follows (until newline)
    //   \x02 = stderr data follows (until newline)
    //   \x03 = exit, next byte is the exit code as a raw byte value
    const body = await readResponseBody(response, d0);
    const buffer = body.buffer;

    let stdout = "";
    let stderr = "";
    const exitMarkerIndex = findExitMarker(buffer);
    const exitCode = exitMarkerIndex === -1
      ? -1
      : (buffer[exitMarkerIndex + 1] ?? 0);
    const outputBuffer = exitMarkerIndex === -1
      ? buffer
      : buffer.subarray(0, exitMarkerIndex);
    const decoder = new TextDecoder();

    let i = 0;
    while (i < outputBuffer.length) {
      const marker = outputBuffer[i];

      // Find the end of this chunk (next newline or end of buffer)
      let end = outputBuffer.indexOf(0x0a, i + 1);
      if (end === -1) { end = outputBuffer.length; }
      const chunk = decoder.decode(outputBuffer.subarray(i + 1, end));

      if (marker === 0x01) {
        stdout += chunk + "\n";
      } else if (marker === 0x02) {
        stderr += chunk + "\n";
      }

      i = end + 1;
    }

    if (exitCode === -1) {
      logger.warn("Exec HTTP response ended without exit marker", {
        fields: {
          spriteName: this.name,
          durationMs: Date.now() - d0,
          fetchHeadersMs,
          responseBytes: buffer.length,
          chunkCount: body.chunkCount,
          lastChunkAtMs: body.lastChunkAtMs,
          contentType: response.headers.get("content-type"),
          contentLength: response.headers.get("content-length"),
          rawTailHex: toHex(buffer.subarray(Math.max(0, buffer.length - 32))),
          readError: body.readError ?? null,
        },
      });
    }

    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode };
  }

  /**
   * Execute a command on the sprite via a WebSocket session.
   * @param command the command to execute
   * @param options the options for the command
   * @returns a promise that resolves to the result of the command
   */
  async execWs(
    command: string,
    options: {
      env?: Record<string, string>;
      cwd?: string;
      idleTimeoutMs?: number;
    } = {},
  ): Promise<ExecResult> {
    const session = this.createSession("sh", ["-c", command], {
      env: options.env,
      cwd: options.cwd,
      idleTimeoutMs: options.idleTimeoutMs,
      tty: false // dont use tty for one-off commands, create a session.
    });

    let stdout = "";
    let stderr = "";
    session.onStdout((data) => {
      stdout += data;
    });
    session.onStderr((data) => {
      stderr += data;
    });

    await session.start();
    const exitCode = await session.wait();
    return { stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode };
  }

  createSession(
    command: string,
    args: string[] = [],
    options: NewExecSessionOptions = {},
  ): SpriteWebsocketSession {
    return new SpriteWebsocketSession(this.name, this.apiKey, this.baseUrl, {
      mode: "exec",
      command,
      args,
      options,
    });
  }

  attachSession(
    sessionId: string,
    options: AttachSessionOptions = {},
  ): SpriteWebsocketSession {
    return new SpriteWebsocketSession(this.name, this.apiKey, this.baseUrl, {
      mode: "attach",
      sessionId,
      options,
    });
  }

  async setNetworkPolicy(rules: NetworkPolicyRule[]): Promise<void> {
    const url = `${this.baseUrl}/v1/sprites/${this.name}/policy/network`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rules }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new SpritesError(
        `Failed to set network policy: ${response.status}`,
        response.status,
        text,
      );
    }
  }

  /**
   * Kills a session/processs running on the sprite.
   * @param sessionId Sprite process ID to kill
   * @param signal Signal to send to the process (default: SIGTERM)
   */
  async killSession(sessionId: number, signal: "SIGINT" | "SIGTERM" = "SIGTERM"): Promise<void> {
    const url = `${this.baseUrl}/v1/sprites/${this.name}/exec/${sessionId}/kill?signal=${signal}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new SpritesError(
        `Failed to kill session ${sessionId}: ${response.status}`,
        response.status,
        text,
      );
    }
  }

  async writeFile(
    path: string,
    content: string,
    options: { mode?: string; mkdir?: boolean } = {},
  ): Promise<void> {
    const url = new URL(`${this.baseUrl}/v1/sprites/${this.name}/fs/write`);
    url.searchParams.set("path", path);

    if (options.mkdir !== false) {
      url.searchParams.set("mkdir", "true");
    }
    if (options.mode) {
      url.searchParams.set("mode", options.mode);
    }

    const response = await fetch(url.toString(), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/octet-stream",
      },
      body: content,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SpritesError(
        `Failed to write file ${path}: ${response.status}`,
        response.status,
        text,
      );
    }
  }

  /**
   * Get sprite info from the REST API, including the public URL.
   */
  async getSpriteInfo(): Promise<SpriteInfoResponse> {
    const url = `${this.baseUrl}/v1/sprites/${this.name}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new SpritesError(
        `Failed to get sprite info: ${response.status}`,
        response.status,
        text,
      );
    }
    return (await response.json()) as SpriteInfoResponse;
  }

  /**
   * Update the sprite's URL auth settings.
   * "public" makes the URL accessible without authentication.
   * "default" requires the Sprites API token (the default).
   */
  async setUrlAuth(auth: SpriteUrlSettings["auth"]): Promise<void> {
    const url = `${this.baseUrl}/v1/sprites/${this.name}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url_settings: { auth } }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new SpritesError(
        `Failed to update URL settings: ${response.status}`,
        response.status,
        text,
      );
    }
  }
}

async function readResponseBody(response: Response, startedAtMs: number): Promise<ResponseBodyRead> {
  if (!response.body) {
    return {
      buffer: new Uint8Array(),
      chunkCount: 0,
      lastChunkAtMs: null,
    };
  }

  const reader = response.body.getReader();
  const buffers: Uint8Array[] = [];
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAtMs: number | null = null;
  let readError: string | undefined;

  while (true) {
    try {
      const { done, value } = await reader.read();
      if (done) { break; }

      chunkCount += 1;
      totalBytes += value.byteLength;
      lastChunkAtMs = Date.now() - startedAtMs;
      buffers.push(value);
    } catch (error) {
      readError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      break;
    }
  }

  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of buffers) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    buffer,
    chunkCount,
    lastChunkAtMs,
    readError,
  };
}

function toHex(value: Uint8Array): string {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function findExitMarker(buffer: Uint8Array): number {
  for (let index = buffer.length - 2; index >= 0; index -= 1) {
    if (buffer[index] !== 0x03) { continue; }
    if (index === 0 || buffer[index - 1] === 0x0a || buffer[index - 1] === 0x0d) {
      return index;
    }
  }

  return -1;
}
