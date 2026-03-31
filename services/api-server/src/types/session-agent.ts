import type { EditorCloseResponse, EditorOpenResponse, PullRequestState, Result, SessionInfoResponse, SessionPlanResponse } from "@repo/shared";
import type { UIMessage } from "ai";

/** POST /pr — set initial pull request info on the DO */
export interface SetPullRequestRequest {
  url: string;
  number: number;
  state: PullRequestState;
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
export type HandleOpenEditorResult = Result<EditorOpenResponse, Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" | "EDITOR_DISABLED" }>>;
export type HandleCloseEditorResult = Result<EditorCloseResponse, Extract<SessionAgentRpcError, { code: "SESSION_NOT_INITIALIZED" | "EDITOR_DISABLED" }>>;
