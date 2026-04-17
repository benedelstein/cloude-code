import type { AgentMode, DomainError } from "@repo/shared";
import type { AgentProcessRunnerError } from "./AgentProcessRunner";

export type WorkflowTurnPayload = {
  userMessage: {
    id: string;
    content?: string;
    attachmentIds: string[];
  };
  model?: string;
  agentMode?: AgentMode;
};

export type SessionTurnWorkflowParams = {
  sessionId: string;
  spriteName: string;
  initialTurn?: WorkflowTurnPayload;
};

export type PrepareWorkflowTurnOverrides = {
  model?: string;
  agentMode?: AgentMode;
};

export const WORKFLOW_TURN_DOMAIN = "workflow-turn" as const;

/**
 * Codes owned by the workflow/coordinator/DO layer (not the agent process runner).
 * Split from AgentProcessRunnerError so callers can narrow without ambiguity.
 */
export type WorkflowTurnOwnedFailure =
  | DomainError<
      typeof WORKFLOW_TURN_DOMAIN,
      | "SESSION_NOT_INITIALIZED"
      | "SESSION_NOT_READY"
      | "USER_NOT_FOUND"
      | "TURN_NOT_ACTIVE"
      | "MESSAGE_NOT_FOUND"
      | "INVALID_MESSAGE"
      | "WORKFLOW_DISPATCH_FAILED"
      | "WORKFLOW_TURN_FAILED",
      object
    >
  | DomainError<
      typeof WORKFLOW_TURN_DOMAIN,
      "INVALID_AGENT_SETTINGS",
      { issues: { path: string; message: string }[] }
    >
  | DomainError<
      typeof WORKFLOW_TURN_DOMAIN,
      "INVALID_MODEL",
      { provider: string; model: string }
    >
  | DomainError<
      typeof WORKFLOW_TURN_DOMAIN,
      "ATTACHMENTS_NOT_FOUND",
      { attachmentIds: string[] }
    >;

export type WorkflowTurnFailure =
  | WorkflowTurnOwnedFailure
  | AgentProcessRunnerError;

/**
 * Builds a workflow-turn-owned failure with the correct domain field.
 * Mirrors agentProcessRunnerError in AgentProcessRunner.ts.
 */
export function workflowTurnFailure<
  Code extends WorkflowTurnOwnedFailure["code"],
>(
  code: Code,
  message: string,
  details: object = {},
): Extract<WorkflowTurnOwnedFailure, { code: Code }> {
  return {
    domain: WORKFLOW_TURN_DOMAIN,
    code,
    message,
    ...details,
  } as Extract<WorkflowTurnOwnedFailure, { code: Code }>;
}
