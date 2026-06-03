import { describe, expect, it, vi } from "vitest";
import type { ClientState, Logger, SessionSetupRun } from "@repo/shared";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import { AgentTurnCoordinator } from "../../src/modules/session-agent/services/agent-turn-coordinator.service";

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

function createRunningInitialAgentStartRun(): SessionSetupRun {
  return {
    id: "setup-run-1",
    mode: "create",
    status: "running",
    startedAt: "2026-06-03T00:00:00.000Z",
    completedAt: null,
    tasks: [
      {
        id: "initial_agent_start",
        isBlocking: true,
        status: "running",
        startedAt: "2026-06-03T00:00:00.000Z",
        completedAt: null,
        error: null,
      },
    ],
  };
}

function createHarness() {
  const serverState = {
    sessionId: "session-1",
    activeUserMessageId: "user-message-1",
    agentProcessId: 42,
  } as ServerState;
  const clientState = {
    status: "preparing",
    sessionSetupRun: createRunningInitialAgentStartRun(),
    activeTurn: { userMessageId: "user-message-1", startedAt: "2026-06-03T00:00:00.000Z" },
    lastError: null,
  } as ClientState;

  const coordinator = new AgentTurnCoordinator({
    logger: createLogger(),
    env: {} as never,
    messageRepository: {} as never,
    pendingChunkRepository: {
      getAll: vi.fn(() => []),
      clear: vi.fn(),
    } as never,
    latestPlanRepository: {} as never,
    getServerState: () => serverState,
    updateServerState: (partial) => Object.assign(serverState, partial),
    getClientState: () => clientState,
    updatePartialState: (partial) => Object.assign(clientState, partial),
    broadcastMessage: vi.fn(),
    synthesizeStatus: () => "preparing",
    terminateActiveProcess: vi.fn(),
    updateWorkingState: vi.fn(),
  });

  return { clientState, coordinator };
}

describe("AgentTurnCoordinator", () => {
  it("does not complete initial_agent_start from webhook ready", () => {
    const { clientState, coordinator } = createHarness();

    coordinator.handleEvent({ type: "ready" });

    expect(clientState.sessionSetupRun?.tasks[0]?.status).toBe("running");
    expect(clientState.sessionSetupRun?.status).toBe("running");
  });

  it("does not fail initial_agent_start from webhook error", () => {
    const { clientState, coordinator } = createHarness();

    coordinator.handleEvent({ type: "error", error: "turn failed" });

    expect(clientState.sessionSetupRun?.tasks[0]?.status).toBe("running");
    expect(clientState.sessionSetupRun?.status).toBe("running");
  });
});
