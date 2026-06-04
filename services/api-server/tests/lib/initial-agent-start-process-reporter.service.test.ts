import { describe, expect, it } from "vitest";
import type {
  ClientState,
  SessionSetupRun,
  SessionSetupTask,
} from "@repo/shared";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import { InitialAgentStartProcessReporter } from "../../src/modules/session-agent/services/initial-agent-start-process-reporter.service";
import { SessionSetupRunService } from "../../src/modules/session-agent/services/session-setup-run.service";
import { managerError } from "../../src/modules/session-agent/types/agent-process-manager.types";

function createServerState(): ServerState {
  return {
    initialized: true,
    sessionId: "session-1",
    userId: "user-1",
    spriteName: "sprite-1",
    repoCloned: true,
    agentSessionId: null,
    agentProcessId: null,
    activeUserMessageId: null,
    startupToolchain: null,
    startupScriptCompleted: true,
    finalNetworkPolicyApplied: true,
  } as ServerState;
}

function createClientState(): ClientState {
  return {
    status: "preparing",
    sessionSetupRun: null,
  } as ClientState;
}

function createHarness(args: {
  prepareTask?: (task: SessionSetupTask) => SessionSetupTask;
} = {}) {
  const serverState = createServerState();
  const clientState = createClientState();
  const setupRunService = new SessionSetupRunService({
    getServerState: () => serverState,
    getClientState: () => clientState,
    updateRunState: (setupRun) => {
      clientState.sessionSetupRun = setupRun;
      clientState.status = setupRun.status === "completed" ? "ready" : "preparing";
    },
  });
  const setupRun = setupRunService.buildRun();
  clientState.sessionSetupRun = {
    ...setupRun,
    tasks: setupRun.tasks.map((task) =>
      args.prepareTask ? args.prepareTask(task) : task,
    ),
  };

  const reporter = new InitialAgentStartProcessReporter({ setupRunService });
  return { clientState, reporter };
}

function completeTask(task: SessionSetupTask): SessionSetupTask {
  return {
    ...task,
    status: "completed",
    startedAt: "2026-06-03T00:00:00.000Z",
    completedAt: "2026-06-03T00:00:00.000Z",
    error: null,
  };
}

function requireSetupRun(clientState: ClientState): SessionSetupRun {
  const setupRun = clientState.sessionSetupRun;
  if (!setupRun) { throw new Error("Expected setup run"); }
  return setupRun;
}

describe("InitialAgentStartProcessReporter", () => {
  it("maps fresh start ready events to initial_agent_start completion", () => {
    const { clientState, reporter } = createHarness({
      prepareTask: (task) =>
        task.id === "initial_agent_start" ? task : completeTask(task),
    });

    reporter.handleProcessStartEvent({
      type: "fresh_start_started",
      userMessageId: "user-message-1",
    });
    expect(
      requireSetupRun(clientState).tasks.find((task) => task.id === "initial_agent_start")
        ?.status,
    ).toBe("running");

    reporter.handleProcessStartEvent({
      type: "fresh_start_ready",
      userMessageId: "user-message-1",
      agentProcessId: 84,
    });

    const setupRun = requireSetupRun(clientState);
    expect(setupRun.status).toBe("completed");
    expect(clientState.status).toBe("ready");
    expect(setupRun.tasks.find((task) => task.id === "initial_agent_start")?.status)
      .toBe("completed");
  });

  it("maps fresh start failures to initial_agent_start failure", () => {
    const { clientState, reporter } = createHarness();
    const error = managerError("TURN_DID_NOT_START", "vm-agent exited before ready");

    reporter.handleProcessStartEvent({
      type: "fresh_start_failed",
      userMessageId: "user-message-1",
      error,
    });

    const setupRun = requireSetupRun(clientState);
    const task = setupRun.tasks.find((candidate) => candidate.id === "initial_agent_start");
    expect(setupRun.status).toBe("failed");
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("vm-agent exited before ready");
  });

  it("ignores fresh start events after initial_agent_start is terminal", () => {
    const { clientState, reporter } = createHarness({
      prepareTask: completeTask,
    });
    clientState.sessionSetupRun = {
      ...requireSetupRun(clientState),
      status: "completed",
      completedAt: "2026-06-03T00:00:00.000Z",
    };

    reporter.handleProcessStartEvent({
      type: "fresh_start_failed",
      userMessageId: "user-message-2",
      error: managerError("TURN_DID_NOT_START", "later restart failed"),
    });

    const setupRun = requireSetupRun(clientState);
    const task = setupRun.tasks.find((candidate) => candidate.id === "initial_agent_start");
    expect(setupRun.status).toBe("completed");
    expect(task?.status).toBe("completed");
    expect(task?.error).toBeNull();
  });
});
