import type { ClientState, ServerMessage } from "@repo/shared";
import type { UIMessageChunk } from "ai";
import type { MessageRepository } from "../repositories/message.repository";
import type { ServerState } from "../repositories/server-state.repository";

type ConnectedMessage = Extract<ServerMessage, { type: "connected" }>;
type SyncResponseMessage = Extract<ServerMessage, { type: "sync.response" }>;

export interface SessionSyncServiceDeps {
  messageRepository: MessageRepository;
  getServerState: () => ServerState;
  getClientState: () => ClientState;
  getPendingChunks: () => UIMessageChunk[] | undefined;
}

export class SessionSyncService {
  private readonly messageRepository: MessageRepository;
  private readonly getServerState: () => ServerState;
  private readonly getClientState: () => ClientState;
  private readonly getPendingChunks: () => UIMessageChunk[] | undefined;

  constructor(deps: SessionSyncServiceDeps) {
    this.messageRepository = deps.messageRepository;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.getPendingChunks = deps.getPendingChunks;
  }

  buildConnectedMessage(): ConnectedMessage {
    return {
      type: "connected",
      sessionId: this.getServerState().sessionId ?? "",
      status: this.getClientState().status,
    };
  }

  buildSyncResponse(): SyncResponseMessage {
    const serverState = this.getServerState();
    const sessionId = serverState.sessionId;
    if (!sessionId) {
      return { type: "sync.response", messages: [], activeTurn: null };
    }

    const storedMessages = this.messageRepository.getAllBySession(sessionId);
    return {
      type: "sync.response",
      messages: storedMessages.map((message) => message.message),
      pendingChunks: this.getPendingChunks(),
      activeTurn: serverState.activeUserMessageId
        ? { userMessageId: serverState.activeUserMessageId }
        : null,
    };
  }
}
