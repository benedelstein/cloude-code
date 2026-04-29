import {
  type AgentMode,
  type AgentSettings,
  type ChatMessageEvent,
  type ClientState,
  type DomainError,
  type Logger,
  type ServerMessage,
  type SessionStatus,
  type Result,
  failure,
  getProviderModelDefinition,
  success,
} from "@repo/shared";
import type { Env } from "@/types";
import type { UIMessage } from "ai";
import type { AttachmentService } from "@/lib/attachments/attachment-service";
import type { AttachmentRecord } from "@/types/attachments";
import { createUserUiMessage, getUserMessageTextContent } from "@/lib/utils/uimessage-utils";
import { updateSessionHistoryData } from "../session-agent-history";
import type { MessageRepository } from "../repositories/message-repository";
import type { ServerState } from "../repositories/server-state-repository";
import type { AgentTurnCoordinator } from "./AgentTurnCoordinator";
import type {
  SpriteAgentProcessManager,
  SpriteAgentProcessManagerError,
} from "./SpriteAgentProcessManager";

const CHAT_DISPATCH_DOMAIN = "chat_dispatch";

export type ChatDispatchError =
  | DomainError<
      typeof CHAT_DISPATCH_DOMAIN,
      | "SESSION_NOT_INITIALIZED"
      | "INVALID_MESSAGE"
      | "INVALID_MODEL"
      | "DISPATCH_FAILED",
      object
    >
  | SpriteAgentProcessManagerError;

function chatDispatchError<
  Code extends Extract<ChatDispatchError, { domain: typeof CHAT_DISPATCH_DOMAIN }>["code"],
>(
  code: Code,
  message: string,
  details: object = {},
): Extract<ChatDispatchError, { code: Code }> {
  return {
    domain: CHAT_DISPATCH_DOMAIN,
    code,
    message,
    ...details,
  } as Extract<ChatDispatchError, { code: Code }>;
}

/**
 * Dependencies injected from the SessionAgentDO into the chat dispatch service.
 */
export interface SessionChatDispatchServiceDeps {
  logger: Logger;
  env: Env;
  messageRepository: MessageRepository;
  attachmentService: AttachmentService;
  turnCoordinator: AgentTurnCoordinator;
  processManager: SpriteAgentProcessManager;

  getServerState: () => ServerState;
  getClientState: () => ClientState;
  updatePartialState: (partial: Partial<ClientState>) => void;
  broadcastMessage: (message: ServerMessage, without?: string[]) => void;
  synthesizeStatus: () => SessionStatus;
}

/**
 * Owns dispatching user chat turns into the vm-agent process.
 * Validates the payload, persists the user message, delegates to
 * SpriteAgentProcessManager to spawn the process, and registers the turn
 * with the coordinator so inbound webhooks can correlate.
 */
export class SessionChatDispatchService {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly messageRepository: MessageRepository;
  private readonly attachmentService: AttachmentService;
  private readonly turnCoordinator: AgentTurnCoordinator;
  private readonly processManager: SpriteAgentProcessManager;
  private readonly getServerState: () => ServerState;
  private readonly getClientState: () => ClientState;
  private readonly updatePartialState: SessionChatDispatchServiceDeps["updatePartialState"];
  private readonly broadcastMessage: SessionChatDispatchServiceDeps["broadcastMessage"];
  private readonly synthesizeStatus: () => SessionStatus;

  constructor(deps: SessionChatDispatchServiceDeps) {
    this.logger = deps.logger.scope("session-chat-dispatch");
    this.env = deps.env;
    this.messageRepository = deps.messageRepository;
    this.attachmentService = deps.attachmentService;
    this.turnCoordinator = deps.turnCoordinator;
    this.processManager = deps.processManager;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.updatePartialState = deps.updatePartialState;
    this.broadcastMessage = deps.broadcastMessage;
    this.synthesizeStatus = deps.synthesizeStatus;
  }

  /**
   * Dispatches a chat message from a client into a new vm-agent turn.
   * Resolves bound attachments, applies any model/agent-mode overrides,
   * persists the user message, and spawns the agent process.
   */
  async dispatchChatMessage(
    payload: ChatMessageEvent,
    connectionId: string,
  ): Promise<Result<void, ChatDispatchError>> {
    const serverState = this.getServerState();
    const sessionId = serverState.sessionId;
    if (!sessionId) {
      return failure(
        chatDispatchError("SESSION_NOT_INITIALIZED", "Session is not initialized"),
      );
    }

    const attachmentIds =
      payload.attachments?.map((attachment) => attachment.attachmentId) ?? [];
    const attachmentRecords = await this.getBoundAttachmentRecords(
      sessionId,
      attachmentIds,
    );

    const content = payload.content?.trim();

    const clientState = this.getClientState();
    let modelOverride: string | undefined;
    if (payload.model && payload.model !== clientState.agentSettings.model) {
      const modelResult = this.validateAndApplyModelSwitch(payload.model);
      if (!modelResult.ok) return failure(modelResult.error);
      modelOverride = modelResult.value;
    }

    let agentModeOverride: AgentMode | undefined;
    if (payload.agentMode && payload.agentMode !== clientState.agentMode) {
      this.updatePartialState({ agentMode: payload.agentMode });
      agentModeOverride = payload.agentMode;
    }

    const userUiMessage = createUserUiMessage(
      content,
      attachmentRecords,
      payload.messageId,
    );
    if (!userUiMessage) {
      return failure(
        chatDispatchError(
          "INVALID_MESSAGE",
          "Message must include content or attachments",
        ),
      );
    }

    this.onUserMessageSent(userUiMessage, attachmentIds, connectionId);

    const dispatchResult = await this.spawnTurn({
      userMessageId: userUiMessage.id,
      content,
      attachmentIds,
      model: modelOverride,
      agentMode: agentModeOverride,
    });
    if (!dispatchResult.ok) {
      this.turnCoordinator.handleTurnSpawnFailed(
        userUiMessage.id,
        dispatchResult.error.message,
      );
      return failure(dispatchResult.error);
    }

    return success(undefined);
  }

  /**
   * Dispatches the pending initial message once provisioning completes.
   * No-op if there is no pending message or a turn is already in flight.
   */
  async maybeDispatchPendingMessage(): Promise<void> {
    const clientState = this.getClientState();
    const serverState = this.getServerState();
    const pendingMessage = clientState.pendingUserMessage;
    if (!pendingMessage || serverState.activeUserMessageId) return;
    const sessionId = serverState.sessionId;
    if (!sessionId) return;

    this.logger.debug(`dispatching pending message: ${pendingMessage.message.id}`);
    const { message: userMessage, attachmentIds } = pendingMessage;
    const content = getUserMessageTextContent(userMessage);

    this.updatePartialState({ pendingUserMessage: null });
    this.onUserMessageSent(userMessage, attachmentIds);

    const dispatchResult = await this.spawnTurn({
      userMessageId: userMessage.id,
      content,
      attachmentIds,
    });
    if (!dispatchResult.ok) {
      this.logger.error("Failed to dispatch pending message", {
        fields: { code: dispatchResult.error.code },
        error: dispatchResult.error.message,
      });
      this.turnCoordinator.handleTurnSpawnFailed(
        userMessage.id,
        dispatchResult.error.message,
      );
    }
  }

  private async spawnTurn(args: {
    userMessageId: string;
    content: string | undefined;
    attachmentIds: string[];
    model?: string;
    agentMode?: AgentMode;
  }): Promise<Result<void, ChatDispatchError>> {
    // Register the turn before spawning so any webhook that races in with
    // chunks is not rejected as stale.
    this.turnCoordinator.beginTurn(args.userMessageId, null);

    const spawnResult = await this.processManager.dispatchMessage({
      userMessage: {
        id: args.userMessageId,
        content: args.content,
        attachmentIds: args.attachmentIds,
      },
      model: args.model,
      agentMode: args.agentMode,
    });
    if (!spawnResult.ok) {
      return failure(spawnResult.error);
    }

    // Record the process id now that we have it so cancel can find it.
    // TODO: clean this up. kind of silly to call beginTurn twice
    this.turnCoordinator.beginTurn(
      args.userMessageId,
      spawnResult.value.agentProcessId,
    );
    return success(undefined);
  }

  private validateAndApplyModelSwitch(
    model: string,
  ): Result<string, ChatDispatchError> {
    const clientState = this.getClientState();
    const validatedModel = getProviderModelDefinition(
      clientState.agentSettings.provider,
      model,
    );
    if (!validatedModel) {
      this.logger.warn("Invalid provider model in chat dispatch", {
        fields: { provider: clientState.agentSettings.provider, model },
      });
      return failure(
        chatDispatchError("INVALID_MODEL", "Invalid model for the current provider", {
          provider: clientState.agentSettings.provider,
          model,
        }),
      );
    }

    this.updatePartialState({
      agentSettings: {
        ...clientState.agentSettings,
        model: validatedModel.id,
      } as AgentSettings,
    });
    return success(validatedModel.id);
  }

  private async getBoundAttachmentRecords(
    sessionId: string,
    attachmentIds: string[],
  ): Promise<AttachmentRecord[]> {
    if (attachmentIds.length === 0) return [];
    return this.attachmentService.getByIdsBoundToSession(sessionId, attachmentIds);
  }

  private onUserMessageSent(
    message: UIMessage,
    attachmentIds: string[],
    connectionId?: string,
  ): void {
    const sessionId = this.getServerState().sessionId;
    if (!sessionId) return;
    const existing = this.messageRepository.getById(message.id);
    if (existing) return;
    const stored = this.messageRepository.create(sessionId, message);
    this.broadcastMessage(
      { type: "user.message", message: stored.message },
      connectionId ? [connectionId] : undefined,
    );

    this.handleSentMessageSideEffects(sessionId, message, attachmentIds);
  }

  private async handleSentMessageSideEffects(
    sessionId: string,
    message: UIMessage,
    attachmentIds: string[],
  ): Promise<void> {
    const content = getUserMessageTextContent(message);
    const attachmentRecords = await this.getBoundAttachmentRecords(
      sessionId,
      attachmentIds,
    );
    const historyContent = this.toHistorySyncContent(content, attachmentRecords);
    await updateSessionHistoryData({
      database: this.env.DB,
      anthropicApiKey: this.env.ANTHROPIC_API_KEY,
      logger: this.logger,
      sessionId,
      messageContent: historyContent,
      messageRepository: this.messageRepository,
    });
  }

  private toHistorySyncContent(
    content: string | undefined,
    attachments: AttachmentRecord[],
  ): string {
    if (content) return content;
    if (attachments.length === 1) {
      return `Uploaded image: ${attachments[0]!.filename}`;
    }
    return `Uploaded ${attachments.length} images`;
  }
}
