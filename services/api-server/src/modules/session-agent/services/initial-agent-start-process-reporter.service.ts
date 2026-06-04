import type {
  AgentProcessStartEvent,
  AgentProcessStartReporter,
} from "../types/agent-process-manager.types";
import type { SessionSetupRunService } from "./session-setup-run.service";

const INITIAL_AGENT_START_TASK_ID = "initial_agent_start";

export interface InitialAgentStartProcessReporterDeps {
  setupRunService: Pick<
    SessionSetupRunService,
    "canUpdateTask" | "startTask" | "completeTask" | "failTask"
  >;
}

/**
 * Maps fresh vm-agent start lifecycle events onto the initial setup checklist.
 */
export class InitialAgentStartProcessReporter implements AgentProcessStartReporter {
  private readonly setupRunService: InitialAgentStartProcessReporterDeps["setupRunService"];

  constructor(deps: InitialAgentStartProcessReporterDeps) {
    this.setupRunService = deps.setupRunService;
  }

  /** Applies a process start event to initial_agent_start when that task is active. */
  handleProcessStartEvent(event: AgentProcessStartEvent): void {
    if (!this.setupRunService.canUpdateTask(INITIAL_AGENT_START_TASK_ID)) {
      return;
    }

    switch (event.type) {
      case "fresh_start_started":
        this.setupRunService.startTask(INITIAL_AGENT_START_TASK_ID);
        return;
      case "fresh_start_ready":
        this.setupRunService.completeTask(INITIAL_AGENT_START_TASK_ID);
        return;
      case "fresh_start_failed":
        this.setupRunService.failTask(
          INITIAL_AGENT_START_TASK_ID,
          event.error.message,
        );
        return;
      default: {
        const exhaustiveCheck: never = event;
        throw new Error(`Unhandled agent process start event: ${exhaustiveCheck}`);
      }
    }
  }
}
