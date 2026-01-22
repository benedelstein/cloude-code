import { SpriteWebsocketSession } from "./SpriteWebsocketSession";
import { ExecResult, SessionOptions, SpritesError } from "./types";

export class WorkersSprite {
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
      } = {}
    ): Promise<ExecResult> {
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
  
      console.log(`Exec response status: ${response.status}`);
  
      if (!response.ok) {
        const text = await response.text();
        console.error(`Exec failed: ${text}`);
        throw new SpritesError(
          `Exec failed: ${response.status}`,
          response.status,
          text
        );
      }
  
      // Response can be NDJSON or plain text depending on the command
      const text = await response.text();
      console.log(`Exec response body (${text.length} chars): ${text.substring(0, 500)}`);
  
      let stdout = "";
      let stderr = "";
      let exitCode = 0;
  
      // Try to parse as NDJSON first
      const lines = text.trim().split("\n");
      let parsedAsJson = false;
  
      for (const line of lines) {
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          parsedAsJson = true;
          if (msg.stdout) stdout += msg.stdout;
          if (msg.stderr) stderr += msg.stderr;
          if (msg.exit_code !== undefined) exitCode = msg.exit_code;
        } catch {
          // Not JSON - will handle as plain text below
        }
      }
  
      // If no JSON was parsed, treat entire response as stdout
      if (!parsedAsJson) {
        stdout = text;
      }
  
      console.log(`Exec result: exitCode=${exitCode}, stdout=${stdout.length} chars, stderr=${stderr.length} chars`);
      return { stdout, stderr, exitCode };
    }
  
    createSession(
      command: string,
      args: string[] = [],
      options: SessionOptions = {}
    ): SpriteWebsocketSession {
      return new SpriteWebsocketSession(
        this.name,
        this.apiKey,
        this.baseUrl,
        command,
        args,
        options
      );
    }
  
    attachSession(
      sessionId: string,
      options: SessionOptions = {}
    ): SpriteWebsocketSession {
      return new SpriteWebsocketSession(this.name, this.apiKey, this.baseUrl, "", [], {
        ...options,
        sessionId,
      });
    }
  }