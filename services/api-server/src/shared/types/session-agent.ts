import type {
  AgentMode,
  AgentSettingsInput,
  AgentEvent,
  CreateSessionInitialMessage,
  PullRequestResponse,
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
  | { code: "BRANCH_NOT_PUSHED"; message: string; status: 400 }
  | { code: "PULL_REQUEST_ALREADY_EXISTS"; message: string; status: 409; url: string }
  | { code: "PULL_REQUEST_CREATE_IN_PROGRESS"; message: string; status: 409 }
  | { code: "INVALID_REPO"; message: string; status: 400 }
  | { code: "PULL_REQUEST_CREATE_FAILED"; message: string; status: 400; details?: string }
  | { code: "EDITOR_DISABLED"; message: string }
  | { code: "SPRITE_NOT_PROVISIONED"; message: string };

export type HandleInitResult = Result<void, Extract<SessionAgentRpcError, { code: "ALREADY_INITIALIZED" }>>;
export type HandleGetSessionResult = Result<SessionInfoResponse, Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" }>>;
export type HandleGetMessagesResult = Result<UIMessage[], Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" }>>;
export type HandleGetPlanResult = Result<SessionPlanResponse, Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" | "PLAN_NOT_FOUND" }>>;
export type HandleDeleteSessionResult = Result<void, Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" }>>;
export type HandleCreatePullRequestResult = Result<
  PullRequestResponse,
  Extract<
    SessionAgentRpcError,
    {
      code:
        | "SESSION_NOT_INITIALIZED"
        | "BRANCH_NOT_PUSHED"
        | "PULL_REQUEST_ALREADY_EXISTS"
        | "PULL_REQUEST_CREATE_IN_PROGRESS"
        | "INVALID_REPO"
        | "PULL_REQUEST_CREATE_FAILED";
    }
  >
>;
export type HandleUpdatePullRequestResult = Result<void, Extract<SessionAgentRpcError, { code: "PULL_REQUEST_NOT_FOUND" }>>;
/** Connection target for the session terminal relay. */
export interface SessionTerminalTarget {
  spriteName: string;
  /** Persisted sprite exec-session id for the user shell, or null if none is live. */
  terminalSessionId: number | null;
}
export type HandleGetTerminalTargetResult = Result<
  SessionTerminalTarget,
  Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" | "SPRITE_NOT_PROVISIONED" }>
>;
export type HandleSetTerminalSessionIdResult = Result<
  void,
  Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" }>
>;

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
  handleCreatePullRequest(): Promise<HandleCreatePullRequestResult>;
  handleGetTerminalTarget(): HandleGetTerminalTargetResult;
  handleSetTerminalSessionId(terminalSessionId: number | null): HandleSetTerminalSessionIdResult;
  updatePullRequest(data: UpdatePullRequestRequest): Promise<HandleUpdatePullRequestResult>;
  enforceSessionAccessBlocked(closeConnections?: boolean): Promise<void>;
}
