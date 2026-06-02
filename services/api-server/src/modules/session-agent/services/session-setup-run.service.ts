import type {
  ClientState,
  SessionSetupRun,
  SessionSetupTask,
  SessionSetupTaskId,
  SessionSetupTaskOutput,
  SessionStatus,
} from "@repo/shared";
import type { ServerState } from "../repositories/server-state.repository";

export interface SessionSetupRunServiceDeps {
  getServerState: () => ServerState;
  getClientState: () => ClientState;
  updatePartialState: (partial: Partial<ClientState>) => void;
  synthesizeStatus: (setupRun?: SessionSetupRun | null) => SessionStatus;
}

/**
 * Owns the public setup checklist state for a SessionAgentDO instance.
 * Callers report task transitions; this service patches ClientState.
 */
export class SessionSetupRunService {
  private readonly getServerState: SessionSetupRunServiceDeps["getServerState"];
  private readonly getClientState: SessionSetupRunServiceDeps["getClientState"];
  private readonly updatePartialState: SessionSetupRunServiceDeps["updatePartialState"];
  private readonly synthesizeStatus: SessionSetupRunServiceDeps["synthesizeStatus"];

  constructor(deps: SessionSetupRunServiceDeps) {
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.updatePartialState = deps.updatePartialState;
    this.synthesizeStatus = deps.synthesizeStatus;
  }

  buildRun(
    mode: SessionSetupRun["mode"],
    taskIds: SessionSetupTaskId[],
  ): SessionSetupRun {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      mode,
      status: "running",
      startedAt: now,
      completedAt: null,
      tasks: taskIds.map((taskId): SessionSetupTask => ({
        id: taskId,
        status: "pending",
        startedAt: null,
        completedAt: null,
        error: null,
        output: null,
      })),
    };
  }

  startTask(taskId: SessionSetupTaskId): void {
    this.updateTask(taskId, (task, now) => {
      if (isTerminalSetupTask(task)) { return task; }
      return {
        ...task,
        status: "running",
        startedAt: task.startedAt ?? now,
        completedAt: null,
        error: null,
      };
    });
  }

  completeTask(taskId: SessionSetupTaskId, output?: SessionSetupTaskOutput): void {
    this.updateTask(taskId, (task, now) => {
      if (task.status === "completed") { return task; }
      if (task.status === "failed" || task.status === "skipped") { return task; }
      return {
        ...task,
        status: "completed",
        startedAt: task.startedAt ?? now,
        completedAt: now,
        error: null,
        output: output ?? task.output,
      };
    });
  }

  failTask(
    taskId: SessionSetupTaskId,
    error: string,
    output?: SessionSetupTaskOutput,
  ): void {
    this.updateTask(taskId, (task, now) => {
      if (task.status === "completed" || task.status === "skipped") { return task; }
      return {
        ...task,
        status: "failed",
        startedAt: task.startedAt ?? now,
        completedAt: now,
        error,
        output: output ?? task.output,
      };
    });
  }

  skipTask(taskId: SessionSetupTaskId): void {
    this.updateTask(taskId, (task, now) => {
      if (isTerminalSetupTask(task)) { return task; }
      return {
        ...task,
        status: "skipped",
        startedAt: task.startedAt ?? now,
        completedAt: now,
        error: null,
      };
    });
  }

  completeRun(): void {
    const setupRun = this.getClientState().sessionSetupRun;
    if (!setupRun || setupRun.status !== "running") { return; }
    if (!this.getServerState().finalNetworkPolicyApplied) { return; }
    if (!setupRun.tasks.every(isTerminalSetupTask)) { return; }
    if (setupRun.tasks.some((task) => task.status === "failed" && task.id !== "setup_script")) {
      return;
    }
    this.updateRun({
      ...setupRun,
      status: "completed",
      completedAt: new Date().toISOString(),
    });
  }

  failRun(_error: string): void {
    const setupRun = this.getClientState().sessionSetupRun;
    if (!setupRun || setupRun.status !== "running") { return; }
    this.updateRun({
      ...setupRun,
      status: "failed",
      completedAt: new Date().toISOString(),
    });
  }

  repairOnStart(): void {
    const setupRun = this.getClientState().sessionSetupRun;
    if (!setupRun || setupRun.status !== "running") { return; }

    const serverState = this.getServerState();
    const now = new Date().toISOString();
    const repairedTasks = setupRun.tasks.map((task): SessionSetupTask => {
      if (isTerminalSetupTask(task)) { return task; }
      switch (task.id) {
        case "cloud_container":
          return serverState.spriteName && serverState.startupToolchain
            ? completeSetupTaskForRepair(task, now)
            : task;
        case "repository":
          return serverState.repoCloned ? completeSetupTaskForRepair(task, now) : task;
        case "setup_script":
          return serverState.startupScriptCompleted
            ? completeSetupTaskForRepair(task, now)
            : task;
        case "initial_agent_start":
          return serverState.activeSetupTaskId === "initial_agent_start"
            ? {
                ...task,
                status: "running",
                startedAt: task.startedAt ?? now,
                completedAt: null,
              }
            : task;
      }
    });

    this.updateRun(this.completeRunIfReady({ ...setupRun, tasks: repairedTasks }));
  }

  private updateTask(
    taskId: SessionSetupTaskId,
    updater: (task: SessionSetupTask, now: string) => SessionSetupTask,
  ): void {
    const setupRun = this.getClientState().sessionSetupRun;
    if (!setupRun || setupRun.status !== "running") { return; }
    const task = setupRun.tasks.find((candidate) => candidate.id === taskId);
    if (!task) { return; }

    const now = new Date().toISOString();
    const nextTask = updater(task, now);
    if (nextTask === task) { return; }

    this.updateRun({
      ...setupRun,
      tasks: setupRun.tasks.map((candidate) =>
        candidate.id === taskId ? nextTask : candidate,
      ),
    });
  }

  private updateRun(setupRun: SessionSetupRun): void {
    this.updatePartialState({
      sessionSetupRun: setupRun,
      status: this.synthesizeStatus(setupRun),
    });
  }

  private completeRunIfReady(setupRun: SessionSetupRun): SessionSetupRun {
    if (setupRun.status !== "running") { return setupRun; }
    if (!this.getServerState().finalNetworkPolicyApplied) { return setupRun; }
    if (!setupRun.tasks.every(isTerminalSetupTask)) { return setupRun; }
    if (setupRun.tasks.some((task) => task.status === "failed" && task.id !== "setup_script")) {
      return setupRun;
    }
    return {
      ...setupRun,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
  }
}

function isTerminalSetupTask(task: SessionSetupTask): boolean {
  return (
    task.status === "completed"
    || task.status === "failed"
    || task.status === "skipped"
  );
}

function completeSetupTaskForRepair(
  task: SessionSetupTask,
  completedAt: string,
): SessionSetupTask {
  return {
    ...task,
    status: "completed",
    startedAt: task.startedAt ?? completedAt,
    completedAt,
    error: null,
  };
}
