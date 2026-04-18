import {
  type AgentMode,
  type AgentSettings,
  type ChatMessageEvent,
  type ClientState,
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
import type { AgentWorkflowCoordinator } from "./AgentWorkflowCoordinator";
import {
  workflowTurnFailure,
  type WorkflowTurnFailure,
} from "@/workflows/types";

/**
 * Dependencies injected from the SessionAgentDO into the chat dispatch service.
 * Keeps coupling explicit and avoids a circular type reference to the DO class.
 */
export interface SessionChatDispatchServiceDeps {
  logger: Logger;
  env: Env;
  messageRepository: MessageRepository;
  attachmentService: AttachmentService;
  workflowCoordinator: AgentWorkflowCoordinator;

  getServerState: () => ServerState;
  getClientState: () => ClientState;
  updatePartialState: (partial: Partial<ClientState>) => void;
  broadcastMessage: (message: ServerMessage, without?: string[]) => void;
  synthesizeStatus: () => SessionStatus;
}

/**
 * Owns dispatching user chat turns into the agent workflow:
 * validates the incoming chat payload (attachments, model, agent mode),
 * persists the user message, syncs session history, and hands off to
 * the workflow coordinator. Also drives the initial-message dispatch
 * after provisioning completes.
 */
export class SessionChatDispatchService {
  private readonly logger: Logger;
  private readonly env: Env;
  private readonly messageRepository: MessageRepository;
  private readonly attachmentService: AttachmentService;
  private readonly workflowCoordinator: AgentWorkflowCoordinator;
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
    this.workflowCoordinator = deps.workflowCoordinator;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.updatePartialState = deps.updatePartialState;
    this.broadcastMessage = deps.broadcastMessage;
    this.synthesizeStatus = deps.synthesizeStatus;
  }

  /**
   * Dispatches a chat message from a client into a new workflow turn.
   * Resolves bound attachments, applies any model/agent-mode overrides,
   * persists the user message, and hands off to the workflow coordinator.
   */
  async dispatchChatMessage(
    payload: ChatMessageEvent,
    connectionId: string,
  ): Promise<Result<void, WorkflowTurnFailure>> {
    const serverState = this.getServerState();
    const sessionId = serverState.sessionId;
    if (!sessionId) {
      return failure(
        workflowTurnFailure("SESSION_NOT_INITIALIZED", "Session is not initialized"),
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
      if (!modelResult.ok) {
        return failure(modelResult.error);
      }
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
        workflowTurnFailure(
          "INVALID_MESSAGE",
          "Message must include content or attachments",
        ),
      );
    }

    try {
      // save before dispatching to workflow to avoid race conditions
      // TODO: mark the message failed if dispatch fails.
      this.onUserMessageSent(userUiMessage, attachmentIds, connectionId);
      this.logger.debug(`dispatching message with id: ${userUiMessage.id}`);
      await this.workflowCoordinator.dispatchTurn({
        userMessage: {
          id: userUiMessage.id,
          content,
          attachmentIds,
        },
        model: modelOverride,
        agentMode: agentModeOverride,
      });
    } catch (error) {
      return failure(
        workflowTurnFailure(
          "WORKFLOW_DISPATCH_FAILED",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }

    return success(undefined);
  }

  /**
   * Dispatches the pending initial message through the session workflow once
   * provisioning completes. No-op if there is no pending message or a turn is
   * already in flight.
   */
  async maybeDispatchPendingMessage(): Promise<void> {
    const clientState = this.getClientState();
    const serverState = this.getServerState();
    const pendingMessage = clientState.pendingUserMessage;
    if (!pendingMessage || serverState.workflowState.activeUserMessageId) {
      return;
    }
    const sessionId = serverState.sessionId;
    if (!sessionId) {
      return;
    }

    const { message: userMessage, attachmentIds } = pendingMessage;
    const content = getUserMessageTextContent(userMessage);

    this.updatePartialState({ pendingUserMessage: null });
    try {
      // TODO: mark the message failed if dispatch fails.
      this.onUserMessageSent(userMessage, attachmentIds);
      await this.workflowCoordinator.dispatchTurn({
        userMessage: {
          id: userMessage.id,
          content,
          attachmentIds,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to dispatch pending workflow message", { error });
      this.updatePartialState({
        lastError: errorMessage,
        status: this.synthesizeStatus(),
      });
      this.broadcastMessage({
        type: "operation.error",
        code: "CHAT_MESSAGE_FAILED",
        message: "Failed to handle chat message",
      });
    }
  }

  private validateAndApplyModelSwitch(
    model: string,
  ): Result<string, WorkflowTurnFailure> {
    const clientState = this.getClientState();
    const validatedModel = getProviderModelDefinition(
      clientState.agentSettings.provider,
      model,
    );
    if (!validatedModel) {
      this.logger.warn("Invalid provider model in workflow model switch", {
        fields: { provider: clientState.agentSettings.provider, model },
      });
      return failure(
        workflowTurnFailure(
          "INVALID_MODEL",
          "Invalid model for the current provider",
          { provider: clientState.agentSettings.provider, model },
        ),
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

  // handle side effects of sending a user message
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
    // Sync to D1 history row and generate title
    const content = getUserMessageTextContent(message);
    // TODO: WHAT IF ATTACHMENT RESOLUTION FAILS?
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
