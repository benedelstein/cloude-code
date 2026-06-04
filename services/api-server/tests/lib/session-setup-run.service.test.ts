import { describe, expect, it } from "vitest";
import type {
  ClientState,
  SessionSetupRun,
  SessionSetupTask,
} from "@repo/shared";
import type { ServerState } from "../../src/modules/session-agent/repositories/server-state.repository";
import { SessionSetupRunService } from "../../src/modules/session-agent/services/session-setup-run.service";

function createServerState(overrides: Partial<ServerState> = {}): ServerState {
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
    ...overrides,
  };
}

function createClientState(): ClientState {
  return {
    status: "preparing",
    sessionSetupRun: null,
  } as ClientState;
}

function createHarness(args: {
  serverState?: Partial<ServerState>;
  prepareTask?: (task: SessionSetupTask) => SessionSetupTask;
} = {}) {
  const serverState = createServerState(args.serverState);
  const clientState = createClientState();
  const service = new SessionSetupRunService({
    getServerState: () => serverState,
    getClientState: () => clientState,
    updateRunState: (setupRun) => {
      clientState.sessionSetupRun = setupRun;
      clientState.status = setupRun.status === "completed" ? "ready" : "preparing";
    },
  });

  const run = service.buildRun("create");
  clientState.sessionSetupRun = {
    ...run,
    tasks: run.tasks.map((task) =>
      args.prepareTask ? args.prepareTask(task) : task,
    ),
  };

  return { clientState, service };
}

function completeTask(task: SessionSetupTask): SessionSetupTask {
  return {
    ...task,
    status: "completed",
    startedAt: "2026-06-02T00:00:00.000Z",
    completedAt: "2026-06-02T00:00:00.000Z",
  };
}

function requireSetupRun(clientState: ClientState): SessionSetupRun {
  const setupRun = clientState.sessionSetupRun;
  if (!setupRun) { throw new Error("Expected setup run"); }
  return setupRun;
}

describe("SessionSetupRunService", () => {
  it("builds typed setup tasks with task-owned blocking metadata", () => {
    const { clientState } = createHarness();

    const setupRun = requireSetupRun(clientState);
    expect(setupRun.tasks.map((task) => [task.id, task.isBlocking])).toEqual([
      ["cloud_container", true],
      ["repository", true],
      ["setup_script", false],
      ["initial_agent_start", true],
    ]);
    expect(setupRun.tasks.find((task) => task.id === "setup_script")).toMatchObject({
      output: null,
      skipReason: null,
    });
  });

  it("auto-completes the run after completing the last pending fatal task", () => {
    const { clientState, service } = createHarness({
      prepareTask: (task) =>
        task.id === "initial_agent_start" ? task : completeTask(task),
    });

    service.completeTask("initial_agent_start");

    const setupRun = requireSetupRun(clientState);
    expect(setupRun.status).toBe("completed");
    expect(setupRun.completedAt).not.toBeNull();
    expect(clientState.status).toBe("ready");
    expect(setupRun.tasks.find((task) => task.id === "initial_agent_start")?.status)
      .toBe("completed");
  });

  it.each(["completeTask", "skipTask"] as const)(
    "%s does not complete the run while another task is pending",
    (transition) => {
      const { clientState, service } = createHarness({
        prepareTask: (task) =>
          task.id === "cloud_container" || task.id === "repository"
            ? task
            : completeTask(task),
      });

      if (transition === "completeTask") {
        service.completeTask("cloud_container");
      } else {
        service.skipTask("cloud_container");
      }

      const setupRun = requireSetupRun(clientState);
      expect(setupRun.status).toBe("running");
      expect(setupRun.completedAt).toBeNull();
      expect(setupRun.tasks.find((task) => task.id === "repository")?.status)
        .toBe("pending");
    },
  );

  it("does not fail the run when setup_script fails", () => {
    const { clientState, service } = createHarness({
      prepareTask: (task) =>
        task.id === "setup_script" ? task : completeTask(task),
    });

    service.failTask("setup_script", "script failed");

    const setupRun = requireSetupRun(clientState);
    expect(setupRun.status).toBe("completed");
    expect(setupRun.tasks.find((task) => task.id === "setup_script")?.status)
      .toBe("failed");
  });

  it.each([
    "initial_agent_start",
    "cloud_container",
    "repository",
  ] as const)("fails the run when %s fails", (taskId) => {
    const { clientState, service } = createHarness();

    service.failTask(taskId, "fatal failure");

    const setupRun = requireSetupRun(clientState);
    expect(setupRun.status).toBe("failed");
    expect(setupRun.completedAt).not.toBeNull();
    expect(setupRun.tasks.find((task) => task.id === taskId)?.status)
      .toBe("failed");
  });
});
