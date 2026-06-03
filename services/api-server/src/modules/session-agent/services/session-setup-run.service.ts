import type {
  ClientState,
  SessionSetupRun,
  SessionSetupTask,
  SessionSetupTaskId,
  SessionSetupTaskNotice,
  SessionSetupTaskOutput,
} from "@repo/shared";
import type { ServerState } from "../repositories/server-state.repository";

export interface SessionSetupRunServiceDeps {
  getServerState: () => ServerState;
  getClientState: () => ClientState;
  updateRunState: (setupRun: SessionSetupRun) => void;
}

/**
 * Owns the public setup checklist state for a SessionAgentDO instance.
 * Callers report task transitions; this service patches ClientState.
 */
export class SessionSetupRunService {
  private readonly getServerState: SessionSetupRunServiceDeps["getServerState"];
  private readonly getClientState: SessionSetupRunServiceDeps["getClientState"];
  private readonly updateRunState: SessionSetupRunServiceDeps["updateRunState"];

  constructor(deps: SessionSetupRunServiceDeps) {
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
    this.updateRunState = deps.updateRunState;
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
      tasks: taskIds.map(createSetupTask),
    };
  }

  startTask(taskId: SessionSetupTaskId): void {
    const setupRun = this.updateTask(taskId, (task, now) => {
      if (isTerminalSetupTask(task)) { return task; }
      return updateSetupTask(task, {
        status: "running",
        startedAt: task.startedAt ?? now,
        completedAt: null,
        error: null,
      });
    });
    if (!setupRun) { return; }
    this.updateRun(setupRun);
  }

  completeTask(taskId: SessionSetupTaskId, output?: SessionSetupTaskOutput): void {
    const setupRun = this.updateTask(taskId, (task, now) => {
      if (task.status === "completed") { return task; }
      if (task.status === "failed" || task.status === "skipped") { return task; }
      const nextTask = updateSetupTask(task, {
        status: "completed",
        startedAt: task.startedAt ?? now,
        completedAt: now,
        error: null,
      });
      return nextTask.id === "setup_script"
        ? { ...nextTask, output: output ?? nextTask.output, notice: null }
        : nextTask;
    });
    if (!setupRun) { return; }
    this.updateRun(this.completeRunIfReady(setupRun));
  }

  failTask(
    taskId: SessionSetupTaskId,
    error: string,
    output?: SessionSetupTaskOutput,
  ): void {
    const setupRun = this.updateTask(taskId, (task, now) => {
      if (task.status === "completed" || task.status === "skipped") { return task; }
      const nextTask = updateSetupTask(task, {
        status: "failed",
        startedAt: task.startedAt ?? now,
        completedAt: now,
        error,
      });
      return nextTask.id === "setup_script"
        ? { ...nextTask, output: output ?? nextTask.output, notice: null }
        : nextTask;
    });
    if (!setupRun) { return; }
    this.updateRun(this.reconcileFailedTask(setupRun, taskId));
  }

  skipTask(taskId: SessionSetupTaskId, notice?: SessionSetupTaskNotice): void {
    const setupRun = this.updateTask(taskId, (task, now) => {
      if (isTerminalSetupTask(task)) { return task; }
      const nextTask = updateSetupTask(task, {
        status: "skipped",
        startedAt: task.startedAt ?? now,
        completedAt: now,
        error: null,
      });
      return nextTask.id === "setup_script"
        ? { ...nextTask, notice: notice ?? null }
        : nextTask;
    });
    if (!setupRun) { return; }
    this.updateRun(this.completeRunIfReady(setupRun));
  }

  completeRun(): void {
    const setupRun = this.getClientState().sessionSetupRun;
    if (!setupRun || setupRun.status !== "running") { return; }
    const nextRun = this.completeRunIfReady(setupRun);
    if (nextRun === setupRun) { return; }
    this.updateRun(nextRun);
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

  /** Recovers setup run state from saved state when the DO restarts. */
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
          return task;
      }
    });

    this.updateRun(this.completeRunIfReady({ ...setupRun, tasks: repairedTasks }));
  }

  private updateTask(
    taskId: SessionSetupTaskId,
    updater: (
      task: SessionSetupTask,
      now: string,
    ) => SessionSetupTask,
  ): SessionSetupRun | null {
    const setupRun = this.getClientState().sessionSetupRun;
    if (!setupRun || setupRun.status !== "running") { return null; }
    const task = setupRun.tasks.find((candidate) => candidate.id === taskId);
    if (!task) { return null; }

    const now = new Date().toISOString();
    const nextTask = updater(task, now);
    if (nextTask === task) { return null; }
    return replaceSetupTask(setupRun, nextTask);
  }

  private updateRun(setupRun: SessionSetupRun): void {
    this.updateRunState(setupRun);
  }

  private completeRunIfReady(setupRun: SessionSetupRun): SessionSetupRun {
    if (setupRun.status !== "running") { return setupRun; }
    if (!this.getServerState().finalNetworkPolicyApplied) { return setupRun; }
    if (!setupRun.tasks.every(isTerminalSetupTask)) { return setupRun; }
    if (setupRun.tasks.some((task) => task.status === "failed" && task.isBlocking)) {
      return setupRun;
    }
    return {
      ...setupRun,
      status: "completed",
      completedAt: new Date().toISOString(),
    };
  }

  private reconcileFailedTask(
    setupRun: SessionSetupRun,
    taskId: SessionSetupTaskId,
  ): SessionSetupRun {
    const failedTask = setupRun.tasks.find((task) => task.id === taskId);
    if (!failedTask) { return setupRun; }
    if (!failedTask.isBlocking) {
      return this.completeRunIfReady(setupRun);
    }
    return {
      ...setupRun,
      status: "failed",
      completedAt: failedTask.completedAt ?? new Date().toISOString(),
    };
  }
}

function isTerminalSetupTask(task: SessionSetupTask): boolean {
  switch (task.status) {
    case "completed":
    case "failed":
    case "skipped":
      return true;
    case "pending":
    case "running":
      return false;
    default: {
      const exhaustiveCheck: never = task.status;
      throw new Error(`Unhandled setup task status: ${exhaustiveCheck}`);
    }
  }
}

function createSetupTask(taskId: SessionSetupTaskId): SessionSetupTask {
  switch (taskId) {
    case "cloud_container": {
      return createBaseSetupTask(taskId, true);
    }
    case "repository": {
      return createBaseSetupTask(taskId, true);
    }
    case "setup_script": {
      return {
        ...createBaseSetupTask(taskId, false),
        output: null,
        notice: null,
      };
    }
    case "initial_agent_start": {
      return createBaseSetupTask(taskId, true);
    }
    default: {
      const exhaustiveCheck: never = taskId;
      throw new Error(`Unhandled setup task id: ${exhaustiveCheck}`);
    }
  }
}

function createBaseSetupTask<Id extends SessionSetupTaskId, IsBlocking extends boolean>(
  taskId: Id,
  isBlocking: IsBlocking,
): {
  id: Id;
  isBlocking: IsBlocking;
  status: "pending";
  startedAt: null;
  completedAt: null;
  error: null;
} {
  return {
    id: taskId,
    isBlocking,
    status: "pending",
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function updateSetupTask(
  task: SessionSetupTask,
  fields: Pick<SessionSetupTask, "status" | "startedAt" | "completedAt" | "error">,
): SessionSetupTask {
  switch (task.id) {
    case "cloud_container":
    case "repository":
    case "initial_agent_start":
      return { ...task, ...fields };
    case "setup_script":
      return { ...task, ...fields };
    default: {
      const exhaustiveCheck: never = task;
      throw new Error(`Unhandled setup task: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function completeSetupTaskForRepair(
  task: SessionSetupTask,
  completedAt: string,
): SessionSetupTask {
  const nextTask = updateSetupTask(task, {
    status: "completed",
    startedAt: task.startedAt ?? completedAt,
    completedAt,
    error: null,
  });
  return nextTask.id === "setup_script" ? { ...nextTask, notice: null } : nextTask;
}

function replaceSetupTask(
  setupRun: SessionSetupRun,
  task: SessionSetupTask,
): SessionSetupRun {
  return {
    ...setupRun,
    tasks: setupRun.tasks.map((candidate) =>
      candidate.id === task.id ? task : candidate,
    ),
  };
}
