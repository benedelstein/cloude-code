import type {
  AgentMode,
  AgentSettingsInput,
  AgentEvent,
  CreateSessionInitialMessage,
  PullRequestState,
  Result,
  SessionInfoResponse,
  SessionPlanResponse,
  SessionEnvironmentSnapshot,
} from "@repo/shared";
import type { UIMessage, UIMessageChunk } from "ai";

export interface InitSessionAgentRequest {
  sessionId: string;
  userId: string;
  repoFullName: string;
  agentSettings?: AgentSettingsInput;
  agentMode?: AgentMode;
  /** Base branch */
  branch?: string;
  environmentSnapshot: SessionEnvironmentSnapshot;
  initialMessage: CreateSessionInitialMessage;
}

/** POST /pr — set initial pull request info on the DO */
export interface SetPullRequestRequest {
  url: string;
  number: number;
  state: PullRequestState;
}

/** Mark pull request creation as failed in live client state. */
export interface SetPullRequestFailedRequest {
  error: string;
  details?: string;
}

/** PATCH /pr — update pull request state on the DO */
export interface UpdatePullRequestRequest {
  state: PullRequestState;
}

// ============================================================
// DO RPC result types — shared between session-agent-do.ts
// and its callers (sessions.service.ts, session-pull-request-service.ts, etc.)
// ============================================================

export type SessionAgentRpcError =
  | { code: "SESSION_NOT_INITIALIZED"; message: string }
  | { code: "ALREADY_INITIALIZED"; message: string; status: 400 }
  | { code: "PLAN_NOT_FOUND"; message: string }
  | { code: "PULL_REQUEST_NOT_FOUND"; message: string }
  | { code: "EDITOR_DISABLED"; message: string };

export type HandleInitResult = Result<void, Extract<SessionAgentRpcError, { code: "ALREADY_INITIALIZED" }>>;
export type HandleGetSessionResult = Result<SessionInfoResponse, Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" }>>;
export type HandleGetMessagesResult = Result<UIMessage[], Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" }>>;
export type HandleGetPlanResult = Result<SessionPlanResponse, Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" | "PLAN_NOT_FOUND" }>>;
export type HandleDeleteSessionResult = Result<void, Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" }>>;
export type HandleUpdatePullRequestResult = Result<void, Extract<SessionAgentRpcError, { code: "PULL_REQUEST_NOT_FOUND" }>>;

export interface SessionAgentRpc {
  refreshProviderConnection(): Promise<void>;
  handleGitProxy(request: Request): Promise<Response>;
  handleWebhookChunks(
    token: string,
    userMessageId: string,
    chunks: Array<{ sequence: number; chunk: UIMessageChunk }>,
  ): Promise<boolean>;
  handleWebhookEvent(token: string, event: AgentEvent): boolean;
  handleInit(request: InitSessionAgentRequest): Promise<HandleInitResult>;
  handleGetSession(): HandleGetSessionResult;
  handleGetMessages(): HandleGetMessagesResult;
  handleGetPlan(): HandleGetPlanResult;
  handleDeleteSession(): Promise<HandleDeleteSessionResult>;
  setPullRequestCreating(): Promise<void>;
  setPullRequest(data: SetPullRequestRequest): Promise<void>;
  setPullRequestFailed(data: SetPullRequestFailedRequest): Promise<void>;
  updatePullRequest(data: UpdatePullRequestRequest): Promise<HandleUpdatePullRequestResult>;
  enforceSessionAccessBlocked(closeConnections?: boolean): Promise<void>;
}
