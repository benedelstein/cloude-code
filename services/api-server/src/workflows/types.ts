import type { AgentMode } from "@repo/shared";

export type WorkflowTurnPayload = {
  messageId: string;
  content?: string;
  attachmentIds: string[];
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

export type WorkflowTurnFailure = {
  message: string;
  code?: string;
  [key: string]: unknown;
};
