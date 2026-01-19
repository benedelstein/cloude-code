import { z } from "zod";

export const SpriteStatus = z.enum([
  "creating",
  "running",
  "stopped",
  "hibernating",
  "error",
]);
export type SpriteStatus = z.infer<typeof SpriteStatus>;

export const Sprite = z.object({
  name: z.string(),
  status: SpriteStatus,
  region: z.string(),
  createdAt: z.string(),
  lastActiveAt: z.string().optional(),
});
export type Sprite = z.infer<typeof Sprite>;

export const CreateSpriteRequest = z.object({
  name: z.string().optional(),
  region: z.string().optional(),
  image: z.string().optional(),
  env: z.record(z.string()).optional(),
});
export type CreateSpriteRequest = z.infer<typeof CreateSpriteRequest>;

export const ExecRequest = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().optional(),
});
export type ExecRequest = z.infer<typeof ExecRequest>;

export const ExecOutput = z.object({
  type: z.enum(["stdout", "stderr", "exit"]),
  data: z.string().optional(),
  exitCode: z.number().optional(),
});
export type ExecOutput = z.infer<typeof ExecOutput>;

export interface SpritesClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

export class SpritesClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: SpritesClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new SpritesError(
          `API request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async createSprite(request: CreateSpriteRequest = {}): Promise<Sprite> {
    const data = await this.request<unknown>("POST", "/sprites", request);
    return Sprite.parse(data);
  }

  async getSprite(name: string): Promise<Sprite> {
    const data = await this.request<unknown>("GET", `/sprites/${name}`);
    return Sprite.parse(data);
  }

  async listSprites(): Promise<Sprite[]> {
    const data = await this.request<unknown[]>("GET", "/sprites");
    return z.array(Sprite).parse(data);
  }

  async deleteSprite(name: string): Promise<void> {
    await this.request("DELETE", `/sprites/${name}`);
  }

  async startSprite(name: string): Promise<Sprite> {
    const data = await this.request<unknown>(
      "POST",
      `/sprites/${name}/start`
    );
    return Sprite.parse(data);
  }

  async stopSprite(name: string): Promise<Sprite> {
    const data = await this.request<unknown>("POST", `/sprites/${name}/stop`);
    return Sprite.parse(data);
  }

  async createCheckpoint(name: string): Promise<{ checkpointId: string }> {
    return this.request("POST", `/sprites/${name}/checkpoint`);
  }

  async restoreCheckpoint(
    name: string,
    checkpointId: string
  ): Promise<Sprite> {
    const data = await this.request<unknown>(
      "POST",
      `/sprites/${name}/restore`,
      { checkpointId }
    );
    return Sprite.parse(data);
  }

  /**
   * Execute a command on a sprite via WebSocket.
   * Returns a WebSocket connection that streams output.
   */
  createExecConnection(spriteName: string): ExecConnection {
    const wsUrl = `${this.baseUrl.replace(/^http/, "ws")}/sprites/${spriteName}/exec`;
    return new ExecConnection(wsUrl, this.apiKey);
  }
}

export class ExecConnection {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private apiKey: string;
  private messageHandlers: Set<(output: ExecOutput) => void> = new Set();
  private errorHandlers: Set<(error: Error) => void> = new Set();
  private closeHandlers: Set<() => void> = new Set();

  constructor(wsUrl: string, apiKey: string) {
    this.wsUrl = wsUrl;
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.wsUrl);
      url.searchParams.set("token", this.apiKey);

      this.ws = new WebSocket(url.toString());

      this.ws.onopen = () => resolve();
      this.ws.onerror = (event) => {
        const error = new Error("WebSocket connection failed");
        reject(error);
        this.errorHandlers.forEach((handler) => handler(error));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          const output = ExecOutput.parse(data);
          this.messageHandlers.forEach((handler) => handler(output));
        } catch (err) {
          const error =
            err instanceof Error ? err : new Error("Failed to parse message");
          this.errorHandlers.forEach((handler) => handler(error));
        }
      };

      this.ws.onclose = () => {
        this.closeHandlers.forEach((handler) => handler());
      };
    });
  }

  exec(request: ExecRequest): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify({ type: "exec", ...request }));
  }

  sendInput(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify({ type: "stdin", data }));
  }

  onMessage(handler: (output: ExecOutput) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export class SpritesError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = "SpritesError";
  }
}
