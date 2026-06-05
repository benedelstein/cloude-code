import {
  UserSessionsServerMessage,
  type Logger,
  type UserSessionsServerMessage as UserSessionsServerMessageType,
} from "@repo/shared";
import { SessionsRepository } from "@/modules/sessions/repositories/sessions.repository";
import { createLogger, initializeLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import { UserSessionsPublishMessage } from "@/shared/types/user-sessions";
import type { LogLevel } from "@repo/shared";

const USER_ID_HEADER = "X-User-Id";

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function createWebSocketPair(): [WebSocket, WebSocket] {
  const pair = new WebSocketPair();
  const sockets = Object.values(pair);
  return [sockets[0]!, sockets[1]!];
}

export class UserSessionsDO implements DurableObject {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly logger: Logger;
  private readonly sessionsRepository: SessionsRepository;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    initializeLogger({
      level: env.LOG_LEVEL as LogLevel,
      format: env.ENVIRONMENT === "production" ? "json" : "pretty",
    });
    this.logger = createLogger("user-sessions.do.ts");
    this.sessionsRepository = new SessionsRepository(env.DB);
  }

  async fetch(request: Request): Promise<Response> {
    const userId = await this.authorizeRequest(request);
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/publish") {
      return this.handlePublish(request, userId);
    }

    if (request.method === "GET" && isWebSocketUpgrade(request)) {
      return this.handleConnect();
    }

    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(_webSocket: WebSocket, _message: string | ArrayBuffer): void {
    // Clients do not send application messages on this stream.
  }

  webSocketClose(
    _webSocket: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): void {
    // No per-socket cleanup required.
  }

  webSocketError(_webSocket: WebSocket, error: unknown): void {
    this.logger.warn("User sessions websocket error", { error });
  }

  private async authorizeRequest(request: Request): Promise<string | null> {
    const requestUserId = request.headers.get(USER_ID_HEADER);
    if (!requestUserId) {
      return null;
    }

    const storedUserId = await this.ctx.storage.get<string>("userId");
    if (!storedUserId) {
      await this.ctx.storage.put("userId", requestUserId);
      return requestUserId;
    }

    if (storedUserId !== requestUserId) {
      this.logger.warn("Rejected user sessions request for mismatched user", {
        fields: { storedUserId, requestUserId },
      });
      return null;
    }

    return storedUserId;
  }

  private handleConnect(): Response {
    const [client, server] = createWebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.send(server, { type: "user_sessions.connected" });
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async handlePublish(
    request: Request,
    userId: string,
  ): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const parsed = UserSessionsPublishMessage.safeParse(body);
    if (!parsed.success) {
      return new Response("Invalid publish message", { status: 400 });
    }

    switch (parsed.data.type) {
      case "session.summary.invalidate":
        await this.broadcastSummary(userId, parsed.data.sessionId);
        return new Response(null, { status: 204 });
      case "session.summary.remove":
        this.broadcast({ type: "session.summary.removed", sessionId: parsed.data.sessionId });
        return new Response(null, { status: 204 });
      case "session.list.resync_required":
        this.broadcast({ type: "session.list.resync_required" });
        return new Response(null, { status: 204 });
      default: {
        const exhaustiveCheck: never = parsed.data;
        throw new Error(`Unhandled user sessions publish message: ${exhaustiveCheck}`);
      }
    }
  }

  private async broadcastSummary(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const summary = await this.sessionsRepository.getByIdForUser(sessionId, userId);
    if (!summary || summary.archived) {
      this.broadcast({ type: "session.summary.removed", sessionId });
      return;
    }

    this.broadcast({ type: "session.summary.updated", session: summary });
  }

  private broadcast(message: UserSessionsServerMessageType): void {
    const parseResult = UserSessionsServerMessage.safeParse(message);
    if (!parseResult.success) {
      this.logger.error("Rejected invalid user sessions outbound message", {
        fields: {
          issues: parseResult.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    const payload = JSON.stringify(parseResult.data);
    for (const webSocket of this.ctx.getWebSockets()) {
      this.sendRaw(webSocket, payload);
    }
  }

  private send(
    webSocket: WebSocket,
    message: UserSessionsServerMessageType,
  ): void {
    const parseResult = UserSessionsServerMessage.safeParse(message);
    if (!parseResult.success) {
      this.logger.error("Rejected invalid user sessions direct message", {
        fields: {
          issues: parseResult.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }
    this.sendRaw(webSocket, JSON.stringify(parseResult.data));
  }

  private sendRaw(webSocket: WebSocket, payload: string): void {
    try {
      webSocket.send(payload);
    } catch (error) {
      this.logger.warn("Failed to send user sessions message", { error });
    }
  }
}
