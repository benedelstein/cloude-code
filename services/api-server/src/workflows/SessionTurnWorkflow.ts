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
import type {
  SessionTurnWorkflowParams,
  WorkflowTurnFailure,
  WorkflowTurnPayload,
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
    const { initialTurn, sessionId, spriteName } = event.payload;
    let nextTurn = initialTurn;
    let turnCount = 0;
    this.logger.debug(`starting workflow${initialTurn ? ` with initial turn` : ""}`);

    while (true) {
      const turnPayload = nextTurn ?? (await this.waitForNextTurn(step, turnCount));
      nextTurn = undefined;

      await step.do(
        `turn:${turnPayload.messageId}`,
        { retries: { limit: 0, delay: "1 second" } },
        async () => {
          await this.runTurn(sessionId, spriteName, turnPayload);
          return { completed: true } as const;
        },
      );

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
    const { messageId, content, attachmentIds, model, agentMode } = turnPayload;
    const logger = this.logger.scope(`turn:${messageId}`);

    try {
      // Cast: Cloudflare RPC Promisify breaks discriminated unions at the type
      // level, but the runtime value is still a plain { ok, value/error } object.
      const preparedTurn = await this.agent.prepareWorkflowTurn(messageId, {
        model,
        agentMode,
      }) as Result<PreparedWorkflowTurn, WorkflowTurnFailure>;
      if (!preparedTurn.ok) {
        await this.agent.onWorkflowTurnFailed(
          messageId,
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
          await this.agent.onWorkflowTurnStarted(messageId, processId);
        },
        onAgentSessionId: async (agentSessionId) => {
          await this.agent.onWorkflowSessionId(messageId, agentSessionId);
        },
        onChunk: async (sequence, chunk) => {
          const c = chunk as { type?: string; toolCallId?: string };
          this.logger.info(`[chunk-trace] workflow onChunk seq=${sequence} type=${c.type}${c.toolCallId ? ` toolCallId=${c.toolCallId}` : ""}`);
          await this.agent.onWorkflowChunk(messageId, sequence, chunk);
        },
      });

      const result = await runner.runTurn({
        content,
        attachmentIds,
        model,
        agentMode,
      });
      if (result.ok) {
        await this.agent.onWorkflowTurnFinished(messageId, result.value);
        return;
      }

      await this.agent.onWorkflowTurnFailed(messageId, result.error);
    } catch (error) {
      logger.error("Workflow turn failed unexpectedly", { error });
      await this.agent.onWorkflowTurnFailed(
        messageId,
        this.toWorkflowTurnFailure(error),
      );
    }
  }

  private toWorkflowTurnFailure(error: unknown): WorkflowTurnFailure {
    if (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      if ("code" in error && typeof (error as { code?: unknown }).code === "string") {
        return error as WorkflowTurnFailure;
      }

      return {
        code: "WORKFLOW_TURN_FAILED",
        message: (error as { message: string }).message,
      };
    }

    return {
      code: "WORKFLOW_TURN_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
