import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { SessionAgentDO } from "@/durable-objects/session-agent-do";
import { createLogger } from "@/lib/logger";
import type { Env } from "@/types";
import type { Result } from "@repo/shared";
import {
  AgentProcessRunner,
  type PreparedWorkflowTurn,
} from "@/workflows/AgentProcessRunner";
import {
  workflowTurnFailure,
  type SessionTurnWorkflowParams,
  type WorkflowTurnFailure,
  type WorkflowTurnPayload,
} from "@/workflows/types";

const MESSAGE_AVAILABLE_EVENT_TYPE = "message_available";

export class SessionTurnWorkflow extends AgentWorkflow<
  SessionAgentDO,
  SessionTurnWorkflowParams,
  Record<string, never>,
  Env
> {
  private readonly logger = createLogger("session-turn-workflow.ts");

  async run(
    event: AgentWorkflowEvent<SessionTurnWorkflowParams>,
    step: AgentWorkflowStep,
  ): Promise<void> {
    console.log("ehllo"); // test. remove
    const { initialTurn, sessionId, spriteName } = event.payload;
    let nextTurn = initialTurn;
    let turnCount = 0;
    this.logger.debug(`starting workflow${initialTurn ? ` with initial turn` : ""}`);

    while (true) {
      const turnPayload = nextTurn ?? (await this.waitForNextTurn(step, turnCount));
      nextTurn = undefined;

      try {
        await step.do(
          `turn:${turnPayload.userMessage.id}`,
          { retries: { limit: 0, delay: "1 second" } },
          async () => {
            await this.runTurn(sessionId, spriteName, turnPayload);
            return { completed: true } as const;
          },
        );
      } catch (error) {
        // Reached if the step body was terminated externally (runtime
        // killed, workflow replayed a persisted failure, etc.) and the
        // step body's own try/catch in runTurn never got to run. This
        // handler executes in whichever runtime resumes the workflow,
        // so the DO still gets notified and the UI doesn't hang.
        this.logger.error("step.do failed; notifying DO from workflow replay", {
          error,
          fields: { userMessageId: turnPayload.userMessage.id, turnCount },
        });
        await this.agent.onWorkflowTurnFailed(
          turnPayload.userMessage.id,
          this.toWorkflowTurnFailure(error),
        );
      }

      turnCount++;
    }
  }

  private async waitForNextTurn(
    step: AgentWorkflowStep,
    turnCount: number,
  ): Promise<WorkflowTurnPayload> {
    this.logger.debug("Waiting for next turn");
    const workflowEvent = await step.waitForEvent<WorkflowTurnPayload>(
      `wait-for-turn:${turnCount}`,
      {
        type: MESSAGE_AVAILABLE_EVENT_TYPE,
      },
    );

    this.logger.debug("Next turn received", { fields: { payload: workflowEvent.payload } });
    return workflowEvent.payload;
  }

  private async runTurn(
    sessionId: string,
    spriteName: string,
    turnPayload: WorkflowTurnPayload,
  ): Promise<void> {
    const { userMessage, model, agentMode } = turnPayload;
    const logger = this.logger.scope(`turn:${userMessage.id}`);

    try {
      // Cast: Cloudflare RPC Promisify breaks discriminated unions at the type
      // level, but the runtime value is still a plain { ok, value/error } object.
      const preparedTurn = await this.agent.prepareWorkflowTurn(userMessage.id, {
        model,
        agentMode,
      }) as Result<PreparedWorkflowTurn, WorkflowTurnFailure>;
      if (!preparedTurn.ok) {
        // The DO has moved on (cancellation, reconnect race, or stale replay).
        // Not a failure of this turn — just skip without surfacing to the UI.
        if (preparedTurn.error.code === "TURN_NOT_ACTIVE") {
          logger.debug("Turn is no longer active; skipping");
          return;
        }
        await this.agent.onWorkflowTurnFailed(
          userMessage.id,
          this.toWorkflowTurnFailure(preparedTurn.error),
        );
        return;
      }

      const runner = new AgentProcessRunner({
        env: this.env,
        logger,
        spriteName,
        sessionId,
        preparedTurn: preparedTurn.value,
        onTurnStarted: async (processId) => {
          await this.agent.onWorkflowTurnStarted(userMessage.id, processId);
        },
        onAgentSessionId: async (agentSessionId) => {
          await this.agent.onWorkflowAgentSessionId(userMessage.id, agentSessionId);
        },
        onChunk: async (sequence, chunk) => {
          await this.agent.onWorkflowChunk(userMessage.id, sequence, chunk);
        },
      });

      const result = await runner.runTurn({
        content: userMessage.content,
        attachmentIds: userMessage.attachmentIds,
        model,
        agentMode,
      });
      if (result.ok) {
        await this.agent.onWorkflowTurnFinished(userMessage.id, result.value);
        return;
      }

      await this.agent.onWorkflowTurnFailed(userMessage.id, result.error);
    } catch (error) {
      logger.error("Workflow turn failed unexpectedly", { error });
      await this.agent.onWorkflowTurnFailed(
        userMessage.id,
        this.toWorkflowTurnFailure(error),
      );
    }
  }

  private toWorkflowTurnFailure(error: unknown): WorkflowTurnFailure {
    if (
      typeof error === "object" &&
      error !== null &&
      "domain" in error &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      return error as WorkflowTurnFailure;
    }

    return workflowTurnFailure(
      "WORKFLOW_TURN_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
}
