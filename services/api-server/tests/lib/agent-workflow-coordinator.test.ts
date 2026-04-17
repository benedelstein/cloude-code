import { describe, expect, it, vi } from "vitest";
import type { ClientState, Logger, ServerMessage } from "@repo/shared";
import type { UIMessageChunk } from "ai";
import { AgentWorkflowCoordinator, type WorkflowTurnCoordinatorDeps } from "../../src/durable-objects/lib/AgentWorkflowCoordinator";
import type { ServerState } from "../../src/durable-objects/repositories/server-state-repository";

function createLoggerStub(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    scope: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createClientState(): ClientState {
  return {
    repoFullName: "owner/repo",
    status: "ready",
    agentSettings: { provider: "claude-code", model: "opus", maxTokens: 8192 },
    agentMode: "edit",
    pushedBranch: null,
    pullRequest: null,
    todos: null,
    plan: null,
    pendingUserMessage: null,
    editorUrl: null,
    providerConnection: null,
    lastError: null,
    baseBranch: "main",
    createdAt: new Date(),
  };
}

function createServerState(overrides: Partial<ServerState> = {}): ServerState {
  const { workflowState: workflowStateOverrides, ...serverStateOverrides } = overrides;
  const workflowState = {
    instanceId: "workflow-1",
    activeUserMessageId: null,
    activeAgentProcessId: null,
    ...workflowStateOverrides,
  };
  const baseServerState: ServerState = {
    initialized: true,
    sessionId: "session-1",
    userId: "user-1",
    spriteName: "sprite-1",
    repoCloned: true,
    agentSessionId: null,
    workflowState,
  };
  return {
    ...baseServerState,
    ...serverStateOverrides,
    workflowState,
  };
}

function createDeps(options?: {
  pendingChunks?: UIMessageChunk[];
  serverState?: ServerState;
}) {
  const logger = createLoggerStub();
  const clientState = createClientState();
  const serverState = options?.serverState ?? createServerState();
  const pendingChunks = options?.pendingChunks ?? [];
  const updatePartialState = vi.fn();
  const updateWorkflowState = vi.fn();
  const updateAgentSessionId = vi.fn();
  const broadcastMessage = vi.fn<(message: ServerMessage) => void>();
  const getWorkflowStatus = vi.fn().mockResolvedValue({ status: "running" });

  const deps: WorkflowTurnCoordinatorDeps = {
    logger,
    env: {} as never,
    messageRepository: {
      getById: vi.fn(),
      create: vi.fn(),
      getAllBySession: vi.fn(),
      delete: vi.fn(),
    } as never,
    pendingChunkRepository: {
      getAll: vi.fn(() => pendingChunks),
      append: vi.fn(),
      clear: vi.fn(),
    } as never,
    latestPlanRepository: {
      upsert: vi.fn(),
    } as never,
    getServerState: () => serverState,
    updateWorkflowState,
    updateAgentSessionId,
    getClientState: () => clientState,
    updatePartialState,
    broadcastMessage,
    synthesizeStatus: () => "ready",
    getWorkflowStatus,
    runWorkflow: vi.fn(),
    getWorkflow: vi.fn(),
    sendWorkflowEvent: vi.fn(),
    restartWorkflow: vi.fn(),
  };

  return {
    deps,
    updatePartialState,
    getWorkflowStatus,
    pendingChunkRepositoryGetAll: deps.pendingChunkRepository.getAll as ReturnType<typeof vi.fn>,
  };
}

describe("AgentWorkflowCoordinator", () => {
  it("rehydrates pending chunks before turn-finished cleanup", () => {
    const todoChunks: UIMessageChunk[] = [
      { type: "start", messageId: "agent-message-1" },
      { type: "tool-input-start", toolCallId: "call-1", toolName: "TodoWrite" },
      {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "TodoWrite",
        input: {
          todos: [{ content: "Inspect bug", status: "in_progress" }],
        },
      },
      { type: "tool-output-available", toolCallId: "call-1", output: { ok: true } },
    ];
    const serverState = createServerState({
      workflowState: {
        instanceId: "workflow-1",
        activeUserMessageId: "user-message-1",
        activeAgentProcessId: null,
      },
    });
    const { deps, updatePartialState } = createDeps({
      pendingChunks: todoChunks,
      serverState,
    });
    const coordinator = new AgentWorkflowCoordinator(deps);

    coordinator.handleTurnFinished("user-message-1", { finishReason: "stop" });

    expect(updatePartialState).toHaveBeenCalledWith({
      todos: [{ content: "Inspect bug", status: "in_progress" }],
    });
    expect(updatePartialState).toHaveBeenCalledWith({
      lastError: null,
      status: "ready",
    });
  });

  it("reconciles active turns even when the WAL is empty", async () => {
    const serverState = createServerState({
      workflowState: {
        instanceId: "workflow-1",
        activeUserMessageId: "user-message-1",
        activeAgentProcessId: null,
      },
    });
    const { deps, getWorkflowStatus, pendingChunkRepositoryGetAll } = createDeps({
      pendingChunks: [],
      serverState,
    });
    const coordinator = new AgentWorkflowCoordinator(deps);

    coordinator.ensureRehydratedState();
    await Promise.resolve();

    expect(pendingChunkRepositoryGetAll).toHaveBeenCalledTimes(1);
    expect(getWorkflowStatus).toHaveBeenCalledWith(
      "SESSION_TURN_WORKFLOW",
      "workflow-1",
    );
  });
});
