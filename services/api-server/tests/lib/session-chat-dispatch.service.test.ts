import {
  DEFAULT_AGENT_SETTINGS,
  type ChatMessageEvent,
  type ClientState,
  type Logger,
  type ServerMessage,
  type SessionStatus,
  success,
} from "@repo/shared";
import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/shared/types";
import type {
  StoredMessage,
  MessageRepository,
} from "../../src/modules/session-agent/repositories/message.repository";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import type { AgentTurnCoordinator } from "../../src/modules/session-agent/services/agent-turn-coordinator.service";
import type { SpriteAgentProcessManager } from "../../src/modules/session-agent/services/agent-process/sprite-agent-process-manager.service";
import {
  SessionChatDispatchService,
  type SessionChatAttachmentProvider,
} from "../../src/modules/session-agent/services/session-chat-dispatch.service";

const historyMockState = vi.hoisted(() => ({
  updateSessionHistoryData: vi.fn(),
}));

vi.mock("../../src/modules/session-agent/services/session-agent-history.service", () => ({
  updateSessionHistoryData: historyMockState.updateSessionHistoryData,
}));

const SESSION_ID = "123e4567-e89b-12d3-a456-426614174010";
const USER_ID = "123e4567-e89b-12d3-a456-426614174001";
const CLIENT_MESSAGE_ID = "123e4567-e89b-12d3-a456-426614174099";
const SERVER_MESSAGE_ID = "123e4567-e89b-12d3-a456-426614174098" as
  `${string}-${string}-${string}-${string}-${string}`;

const noopLogger: Logger = {
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  scope: () => noopLogger,
};

function makeServerState(): ServerState {
  return {
    initialized: true,
    sessionId: SESSION_ID,
    userId: USER_ID,
    spriteName: "sprite-test",
    repoCloned: true,
    agentSessionId: null,
    agentProcessId: null,
    activeUserMessageId: null,
    startupToolchain: null,
    startupScriptCompleted: true,
    finalNetworkPolicyApplied: true,
  };
}

function makeClientState(): ClientState {
  return {
    repoFullName: "owner/repo",
    status: "ready",
    sessionSetupRun: null,
    agentSettings: DEFAULT_AGENT_SETTINGS,
    pullRequest: null,
    pushedBranch: null,
    baseBranch: null,
    todos: null,
    plan: null,
    pendingUserMessage: null,
    activeTurn: null,
    editorUrl: null,
    providerConnection: null,
    agentMode: "edit",
    lastError: null,
    createdAt: new Date("2026-05-24T10:00:00.000Z"),
  };
}

function makeMessageRepository(): MessageRepository {
  const repository = {
    getById: vi.fn((_id: string): StoredMessage | null => null),
    create: vi.fn((sessionId: string, message: UIMessage): StoredMessage => ({
      sessionId,
      createdAt: "2026-05-24T10:00:01.000Z",
      message,
    })),
    getAllBySession: vi.fn((_sessionId: string): StoredMessage[] => []),
  };
  return repository as unknown as MessageRepository;
}

function makeChatDispatchHarness(params: {
  publishSessionSummaryInvalidated: (userId: string, sessionId: string) => Promise<void>;
}) {
  const turnCoordinator = {
    beginTurn: vi.fn(),
    attachProcessId: vi.fn(),
    handleTurnSpawnFailed: vi.fn(),
  } as unknown as AgentTurnCoordinator;
  const processManager = {
    dispatchMessage: vi.fn(async () => success({ agentProcessId: 42 })),
  } as unknown as SpriteAgentProcessManager;
  const attachmentService: SessionChatAttachmentProvider = {
    getByIdsBoundToSession: vi.fn(async () => []),
  };
  const messageRepository = makeMessageRepository();
  const broadcastMessage = vi.fn((_message: ServerMessage, _without?: string[]) => {});
  const sendMessageToConnection = vi.fn((_message: ServerMessage, _connectionId: string) => {});

  const service = new SessionChatDispatchService({
    logger: noopLogger,
    env: {
      DB: {} as D1Database,
      ANTHROPIC_API_KEY: "test-api-key",
    } as unknown as Env,
    messageRepository,
    attachmentService,
    turnCoordinator,
    processManager,
    getServerState: makeServerState,
    getClientState: makeClientState,
    updatePartialState: vi.fn(),
    broadcastMessage,
    sendMessageToConnection,
    synthesizeStatus: vi.fn((): SessionStatus => "ready"),
    publishSessionSummaryInvalidated: params.publishSessionSummaryInvalidated,
  });

  return {
    service,
    messageRepository,
    broadcastMessage,
    sendMessageToConnection,
    turnCoordinator,
    processManager,
  };
}

function makeChatDispatchService(params: {
  publishSessionSummaryInvalidated: (userId: string, sessionId: string) => Promise<void>;
}): SessionChatDispatchService {
  return makeChatDispatchHarness(params).service;
}

function makeChatMessage(): ChatMessageEvent {
  return {
    type: "chat.message",
    content: "Update sidebar title",
    clientMessageId: CLIENT_MESSAGE_ID,
  };
}

describe("SessionChatDispatchService", () => {
  beforeEach(() => {
    historyMockState.updateSessionHistoryData.mockReset();
    vi.restoreAllMocks();
  });

  it("stores, broadcasts, and dispatches the server-generated user message id", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(SERVER_MESSAGE_ID);
    const harness = makeChatDispatchHarness({
      publishSessionSummaryInvalidated: vi.fn(async () => {}),
    });

    const result = await harness.service.dispatchChatMessage(makeChatMessage(), "connection-1");

    expect(result).toEqual(success(undefined));
    expect(harness.messageRepository.create).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ id: SERVER_MESSAGE_ID }),
    );
    expect(harness.messageRepository.create).not.toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ id: CLIENT_MESSAGE_ID }),
    );
    expect(harness.sendMessageToConnection).toHaveBeenCalledWith(
      {
        type: "chat.accepted",
        clientMessageId: CLIENT_MESSAGE_ID,
        messageId: SERVER_MESSAGE_ID,
      },
      "connection-1",
    );
    expect(harness.broadcastMessage).toHaveBeenCalledWith(
      {
        type: "user.message",
        message: expect.objectContaining({ id: SERVER_MESSAGE_ID }),
      },
      ["connection-1"],
    );
    expect(harness.turnCoordinator.beginTurn).toHaveBeenCalledWith(SERVER_MESSAGE_ID);
    expect(harness.processManager.dispatchMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.objectContaining({ id: SERVER_MESSAGE_ID }),
      }),
    );
    expect(harness.messageRepository.create.mock.invocationCallOrder[0]).toBeLessThan(
      harness.sendMessageToConnection.mock.invocationCallOrder[0]!,
    );
    expect(harness.sendMessageToConnection.mock.invocationCallOrder[0]).toBeLessThan(
      harness.broadcastMessage.mock.invocationCallOrder[0]!,
    );
    expect(harness.broadcastMessage.mock.invocationCallOrder[0]).toBeLessThan(
      harness.turnCoordinator.beginTurn.mock.invocationCallOrder[0]!,
    );
  });

  it("publishes a summary invalidation only after history persistence resolves", async () => {
    const operations: string[] = [];
    const historyDeferred = Promise.withResolvers<{ updatedSessionSummary: boolean }>();
    const publishDeferred = Promise.withResolvers<void>();
    historyMockState.updateSessionHistoryData.mockImplementation(async () => {
      operations.push("history:start");
      const result = await historyDeferred.promise;
      operations.push("history:done");
      return result;
    });
    const publishSessionSummaryInvalidated = vi.fn(async () => {
      operations.push("publish");
      publishDeferred.resolve();
    });
    const service = makeChatDispatchService({ publishSessionSummaryInvalidated });

    await service.dispatchChatMessage(makeChatMessage(), "connection-1");
    await Promise.resolve();

    expect(operations).toEqual(["history:start"]);
    expect(publishSessionSummaryInvalidated).not.toHaveBeenCalled();

    historyDeferred.resolve({ updatedSessionSummary: true });
    await publishDeferred.promise;

    expect(operations).toEqual(["history:start", "history:done", "publish"]);
    expect(publishSessionSummaryInvalidated).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
    );
  });

  it("does not publish when history persistence fails", async () => {
    const historyDone = Promise.withResolvers<void>();
    historyMockState.updateSessionHistoryData.mockImplementation(async () => {
      historyDone.resolve();
      return { updatedSessionSummary: false };
    });
    const publishSessionSummaryInvalidated = vi.fn(async () => {});
    const service = makeChatDispatchService({ publishSessionSummaryInvalidated });

    await service.dispatchChatMessage(makeChatMessage(), "connection-1");
    await historyDone.promise;
    await Promise.resolve();

    expect(publishSessionSummaryInvalidated).not.toHaveBeenCalled();
  });
});
