import { describe, expect, it, vi } from "vitest";
import type { ClientState, Logger } from "@repo/shared";
import type { UIMessage, UIMessageChunk } from "ai";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import {
  AgentTurnCoordinator,
  type FinishedAssistantTurn,
} from "../../src/modules/session-agent/services/agent-turn-coordinator.service";

function createLogger(): Logger {
  return {
    log() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    scope() {
      return this;
    },
  };
}

function createHarness(params: {
  onTurnFinished?: (turn: FinishedAssistantTurn) => void;
} = {}) {
  const serverState = {
    sessionId: "session-1",
    activeUserMessageId: "user-message-1",
    agentProcessId: 42,
    agentProcessRunId: "process-run-1",
  } as ServerState;
  const clientState = {
    status: "ready",
    sessionSetupRun: null,
    activeTurn: { userMessageId: "user-message-1", startedAt: "2026-06-03T00:00:00.000Z" },
    lastError: null,
  } as ClientState;
  const pendingChunkRepository = {
    getAll: vi.fn(() => []),
    appendIfNew: vi.fn(() => true),
    clear: vi.fn(),
  };
  const broadcastMessage = vi.fn();
  const messageRepository = {
    create: vi.fn((sessionId: string, message: UIMessage) => ({
      sessionId,
      createdAt: "2026-06-03T00:00:00.000Z",
      message,
    })),
  };
  const updateWorkingState = vi.fn();
  const onTurnFinished = params.onTurnFinished ?? ((turn: FinishedAssistantTurn) => {
    if (turn.aborted) {
      updateWorkingState("idle");
    }
  });

  const coordinator = new AgentTurnCoordinator({
    logger: createLogger(),
    env: {} as never,
    messageRepository: messageRepository as never,
    pendingChunkRepository: pendingChunkRepository as never,
    latestPlanRepository: {} as never,
    getServerState: () => serverState,
    updateServerState: (partial) => Object.assign(serverState, partial),
    getClientState: () => clientState,
    updatePartialState: (partial) => Object.assign(clientState, partial),
    broadcastMessage,
    synthesizeStatus: () => "preparing",
    terminateActiveProcess: vi.fn(),
    updateWorkingState,
    onTurnFinished,
  });

  return {
    broadcastMessage,
    clientState,
    coordinator,
    messageRepository,
    serverState,
    updateWorkingState,
  };
}

describe("AgentTurnCoordinator", () => {
  it("runs the turn-finished hook after broadcasting a terminal assistant message", async () => {
    const onTurnFinished = vi.fn();
    const {
      broadcastMessage,
      coordinator,
      messageRepository,
      serverState,
      updateWorkingState,
    } = createHarness({
      onTurnFinished,
    });

    await coordinator.handleChunks("user-message-1", [
      { sequence: 0, chunk: { type: "start", messageId: "assistant-message-1" } as UIMessageChunk },
      { sequence: 1, chunk: { type: "finish", finishReason: "stop" } as UIMessageChunk },
    ]);

    expect(messageRepository.create).toHaveBeenCalledOnce();
    expect(broadcastMessage).toHaveBeenLastCalledWith({
      type: "agent.finish",
      message: expect.objectContaining({ id: "assistant-message-1" }),
    });
    expect(onTurnFinished).toHaveBeenCalledOnce();
    expect(onTurnFinished).toHaveBeenCalledWith({
      message: expect.objectContaining({ id: "assistant-message-1" }),
      messageCreatedAt: "2026-06-03T00:00:00.000Z",
      aborted: false,
    });
    expect(updateWorkingState).not.toHaveBeenCalledWith("idle");
    expect(serverState.activeUserMessageId).toBeNull();
  });

  it("runs the turn-finished hook with abort for aborted assistant messages", async () => {
    const onTurnFinished = vi.fn();
    const { coordinator, updateWorkingState } = createHarness({ onTurnFinished });

    await coordinator.handleChunks("user-message-1", [
      { sequence: 0, chunk: { type: "start", messageId: "assistant-message-1" } as UIMessageChunk },
      { sequence: 1, chunk: { type: "abort" } as UIMessageChunk },
    ]);

    expect(onTurnFinished).toHaveBeenCalledWith({
      message: expect.objectContaining({ id: "assistant-message-1" }),
      messageCreatedAt: "2026-06-03T00:00:00.000Z",
      aborted: true,
    });
    expect(updateWorkingState).not.toHaveBeenCalledWith("idle");
  });

  it("clears the tracked agent process when the matching process exits", () => {
    const { coordinator, serverState } = createHarness();

    coordinator.handleEvent({
      type: "process_exit",
      processRunId: "process-run-1",
      exitCode: 0,
    });

    expect(serverState.agentProcessId).toBeNull();
    expect(serverState.agentProcessRunId).toBeNull();
  });

  it("aborts the active turn when the matching process exits mid-stream", async () => {
    const {
      broadcastMessage,
      clientState,
      coordinator,
      messageRepository,
      serverState,
      updateWorkingState,
    } = createHarness();

    await coordinator.handleChunks("user-message-1", [
      { sequence: 0, chunk: { type: "start", messageId: "assistant-message-1" } as UIMessageChunk },
      { sequence: 1, chunk: { type: "text-start", id: "text-1" } as UIMessageChunk },
      { sequence: 2, chunk: { type: "text-delta", id: "text-1", delta: "partial" } as UIMessageChunk },
    ]);

    coordinator.handleEvent({
      type: "process_exit",
      processRunId: "process-run-1",
      exitCode: 0,
    });

    expect(messageRepository.create).toHaveBeenCalledOnce();
    expect(broadcastMessage).toHaveBeenLastCalledWith({
      type: "agent.finish",
      message: expect.objectContaining({
        id: "assistant-message-1",
        metadata: expect.objectContaining({ aborted: true }),
      }),
    });
    expect(serverState.activeUserMessageId).toBeNull();
    expect(serverState.agentProcessId).toBeNull();
    expect(serverState.agentProcessRunId).toBeNull();
    expect(clientState.activeTurn).toBeNull();
    expect(updateWorkingState).toHaveBeenLastCalledWith("idle");
  });

  it("ignores stale process exit events from older runs", () => {
    const { coordinator, serverState } = createHarness();

    coordinator.handleEvent({
      type: "process_exit",
      processRunId: "old-process-run",
      exitCode: 0,
    });

    expect(serverState.agentProcessId).toBe(42);
    expect(serverState.agentProcessRunId).toBe("process-run-1");
  });

  it("aborts an active turn with no agent process during reconcile", async () => {
    const {
      clientState,
      coordinator,
      serverState,
      updateWorkingState,
    } = createHarness();
    serverState.agentProcessId = null;
    serverState.agentProcessRunId = null;
    serverState.spriteName = "sprite-1";

    await coordinator.reconcileActiveTurnIfNeeded();

    expect(serverState.activeUserMessageId).toBeNull();
    expect(clientState.activeTurn).toBeNull();
    expect(updateWorkingState).toHaveBeenCalledWith("idle");
  });

  it("aborts an active turn with no sprite name during reconcile", async () => {
    const { clientState, coordinator, serverState } = createHarness();
    serverState.spriteName = null;

    await coordinator.reconcileActiveTurnIfNeeded();

    expect(serverState.activeUserMessageId).toBeNull();
    expect(clientState.activeTurn).toBeNull();
  });

  it("reconciles an orphaned active turn only once per instance", async () => {
    const { coordinator, serverState, updateWorkingState } = createHarness();
    serverState.agentProcessId = null;
    serverState.spriteName = "sprite-1";

    await coordinator.reconcileActiveTurnIfNeeded();
    expect(serverState.activeUserMessageId).toBeNull();

    updateWorkingState.mockClear();
    serverState.activeUserMessageId = "user-message-2";

    await coordinator.reconcileActiveTurnIfNeeded();

    expect(serverState.activeUserMessageId).toBe("user-message-2");
    expect(updateWorkingState).not.toHaveBeenCalled();
  });
});
