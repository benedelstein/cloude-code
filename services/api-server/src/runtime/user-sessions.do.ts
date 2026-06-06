import {
  UserSessionsServerMessage,
  type Logger,
  type UserSessionsServerMessage as UserSessionsServerMessageType,
} from "@repo/shared";
import { DurableObject } from "cloudflare:workers";
import { SessionsRepository } from "@/modules/sessions/repositories/sessions.repository";
import { createLogger, initializeLogger } from "@/shared/logging";
import type { Env } from "@/shared/types";
import {
  USER_SESSIONS_USER_ID_HEADER,
  UserSessionsSessionRpcRequestSchema,
  UserSessionsUserRpcRequestSchema,
  type UserSessionsRpc,
  type UserSessionsSessionRpcRequest,
  type UserSessionsUserRpcRequest,
} from "@/shared/types/user-sessions";
import type { LogLevel } from "@repo/shared";

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function createWebSocketPair(): [WebSocket, WebSocket] {
  const pair = new WebSocketPair();
  const sockets = Object.values(pair);
  return [sockets[0]!, sockets[1]!];
}

export class UserSessionsDO extends DurableObject<Env> implements UserSessionsRpc {
  private readonly logger: Logger;
  private readonly sessionsRepository: SessionsRepository;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeLogger({
      level: env.LOG_LEVEL as LogLevel,
      format: env.ENVIRONMENT === "production" ? "json" : "pretty",
    });
    this.logger = createLogger("user-sessions.do.ts");
    this.sessionsRepository = new SessionsRepository(env.DB);
    this.logger.debug("User sessions DO initialized", {
      fields: {
        env: env.ENVIRONMENT,
        logLevel: env.LOG_LEVEL,
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/") {
      return new Response("Not found", { status: 404 });
    }

    const userId = this.authorizeRequest(request);
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (request.method === "GET" && isWebSocketUpgrade(request)) {
      return this.handleConnect();
    }

    return new Response("Expected WebSocket upgrade", { status: 400 });
  }

  async invalidateSessionSummary(
    request: UserSessionsSessionRpcRequest,
  ): Promise<void> {
    const parsed = this.parseSessionRpcRequest(request);
    this.assertUserScope(parsed.userId);
    await this.broadcastSummary(parsed.userId, parsed.sessionId, "session.summary.updated");
  }

  async createSessionSummary(
    request: UserSessionsSessionRpcRequest,
  ): Promise<void> {
    const parsed = this.parseSessionRpcRequest(request);
    this.assertUserScope(parsed.userId);
    await this.broadcastSummary(parsed.userId, parsed.sessionId, "session.summary.created");
  }

  async removeSessionSummary(
    request: UserSessionsSessionRpcRequest,
  ): Promise<void> {
    const parsed = this.parseSessionRpcRequest(request);
    this.assertUserScope(parsed.userId);
    this.broadcast({
      type: "session.summary.removed",
      sessionId: parsed.sessionId,
    });
  }

  async requestResync(request: UserSessionsUserRpcRequest): Promise<void> {
    const parsed = this.parseUserRpcRequest(request);
    this.assertUserScope(parsed.userId);
    this.broadcast({ type: "session.list.resync_required" });
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

  private authorizeRequest(request: Request): string | null {
    const requestUserId = request.headers.get(USER_SESSIONS_USER_ID_HEADER);
    if (!requestUserId) {
      return null;
    }

    const parsed = UserSessionsUserRpcRequestSchema.safeParse({
      userId: requestUserId,
    });
    if (!parsed.success) {
      return null;
    }

    const authorized = this.authorizeUser(parsed.data.userId);
    return authorized ? parsed.data.userId : null;
  }

  private assertUserScope(userId: string): void {
    if (this.authorizeUser(userId)) {
      return;
    }

    throw new Error("User sessions Durable Object scoped to a different user");
  }

  private authorizeUser(requestUserId: string): boolean {
    const storedUserId = this.getStoredUserId();
    if (!storedUserId) {
      this.ctx.storage.kv.put("userId", requestUserId);
      this.logger.debug("Initialized user sessions DO user", {
        fields: { userId: requestUserId },
      });
      return true;
    }

    if (storedUserId !== requestUserId) {
      this.logger.warn("Rejected user sessions request for mismatched user", {
        fields: { storedUserId, requestUserId },
      });
      return false;
    }

    return true;
  }

  private getStoredUserId(): string | null {
    return this.ctx.storage.kv.get<string>("userId") ?? null;
  }

  private parseSessionRpcRequest(
    request: UserSessionsSessionRpcRequest,
  ): UserSessionsSessionRpcRequest {
    const parsed = UserSessionsSessionRpcRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new Error("Invalid user sessions RPC session request");
    }
    return parsed.data;
  }

  private parseUserRpcRequest(
    request: UserSessionsUserRpcRequest,
  ): UserSessionsUserRpcRequest {
    const parsed = UserSessionsUserRpcRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new Error("Invalid user sessions RPC user request");
    }
    return parsed.data;
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

  private async broadcastSummary(
    userId: string,
    sessionId: string,
    type: "session.summary.created" | "session.summary.updated",
  ): Promise<void> {
    const summary = await this.sessionsRepository.getByIdForUser(sessionId, userId);
    if (!summary || summary.archived) {
      this.broadcast({ type: "session.summary.removed", sessionId });
      return;
    }

    this.broadcast({ type, session: summary });
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
      this._sendRaw(webSocket, payload);
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
    this._sendRaw(webSocket, JSON.stringify(parseResult.data));
  }

  private _sendRaw(webSocket: WebSocket, payload: string): void {
    try {
      webSocket.send(payload);
    } catch (error) {
      this.logger.warn("Failed to send user sessions message", { error });
    }
  }
}
