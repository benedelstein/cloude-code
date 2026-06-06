import type { UIMessage } from "ai";
import { z } from "zod";
import {
  AgentSettings,
  ProviderId,
} from "./providers/index";

export const SessionStatus = z.enum([
  /** Session setup is still in progress or blocked. */
  "preparing",
  /** Ready to send and receive messages */
  "ready",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export type SessionSetupRunStatus = "running" | "completed" | "failed";
export type SessionSetupTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type SessionSetupTaskOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
};

export type StartupScriptSetupTaskSkipReason =
  | {
      kind: "no_environment";
      repoId: number;
    }
  | {
      kind: "no_script";
      environmentId: string;
      environmentName: string | null;
    };

export type BaseSessionSetupTask = {
  id: string;
  isBlocking: boolean;
  status: SessionSetupTaskStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export type CloudContainerSetupTask = BaseSessionSetupTask & {
  id: "cloud_container";
  isBlocking: true;
};

export type RepositorySetupTask = BaseSessionSetupTask & {
  id: "repository";
  isBlocking: true;
};

export type StartupScriptSetupTask = BaseSessionSetupTask & {
  id: "setup_script";
  isBlocking: false;
  output: SessionSetupTaskOutput | null;
  skipReason: StartupScriptSetupTaskSkipReason | null;
};

export type NetworkPolicySetupTask = BaseSessionSetupTask & {
  id: "network_policy";
  isBlocking: true;
};

export type SessionSetupTask =
  | CloudContainerSetupTask
  | RepositorySetupTask
  | StartupScriptSetupTask
  | NetworkPolicySetupTask;

export type SessionSetupTaskId = SessionSetupTask["id"];

export type SessionSetupRun = {
  id: string;
  status: SessionSetupRunStatus;
  startedAt: string;
  completedAt: string | null;
  tasks: SessionSetupTask[];
};

export const PullRequestState = z.enum(["open", "merged", "closed"]);
export type PullRequestState = z.infer<typeof PullRequestState>;

export const PullRequestClientState = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("creating"),
  }),
  z.object({
    status: z.literal("failed"),
    error: z.string(),
    details: z.string().optional(),
  }),
  z.object({
    status: z.literal("created"),
    url: z.string(),
    number: z.number(),
    state: PullRequestState,
  }),
]);
export type PullRequestClientState = z.infer<typeof PullRequestClientState>;

export const SessionWorkingState = z.enum(["idle", "responding"]);
export type SessionWorkingState = z.infer<typeof SessionWorkingState>;

/** Generic provider auth state for the frontend. */
export type ProviderAuthRequired = {
  providerId: ProviderId;
  state: "auth_required" | "reauth_required";
} | null;

export const SessionAccessBlockReason = z.enum([
  "INSTALLATION_DELETED",
  "INSTALLATION_SUSPENDED",
  "REPO_REMOVED_FROM_INSTALLATION",
  /** Access denied during runtime auth check - unknown reason (potentially user lost access or webhook out of date) */
  "ACCESS_CHECK_DENIED",
]);
export type SessionAccessBlockReason = z.infer<typeof SessionAccessBlockReason>;

export const SessionTodoStatus = z.enum(["pending", "in_progress", "completed"]);
export type SessionTodoStatus = z.infer<typeof SessionTodoStatus>;

export const SessionTodo = z.object({
  content: z.string(),
  activeForm: z.string().optional(),
  status: SessionTodoStatus,
});
export type SessionTodo = z.infer<typeof SessionTodo>;

export const SessionPlanMetadata = z.object({
  lastUpdated: z.string(),
});
export type SessionPlanMetadata = z.infer<typeof SessionPlanMetadata>;

export type ProviderConnectionState = {
  provider: ProviderId;
  connected: boolean;
  requiresReauth: boolean;
};

export type ActiveTurnState = {
  userMessageId: string;
};

/**
 * Durable state synced to clients via Cloudflare Agents SDK.
 * IMPORTANT: ClientState IS PROPAGATED TO CLIENTS. DO NOT PUT SENSITIVE DATA HERE.
 *
 * Fields marked "reset on restart" are overwritten in the DO constructor so they
 * never get stuck from a previous instance's in-progress operation.
 */
export type ClientState = {
  repoFullName: string | null;
  /** Synthesized from ServerState checkpoints — reset on restart */
  status: SessionStatus;
  /** Public setup checklist shown while a session is preparing. */
  sessionSetupRun: SessionSetupRun | null;
  agentSettings: AgentSettings;
  pullRequest: PullRequestClientState | null;
  /** Branch name locked after first push (for "Create PR" flow) */
  pushedBranch: string | null;
  /** Branch the session was based off — used as the PR target */
  baseBranch: string | null;
  /** Latest streamed todo snapshot from the provider todo tool */
  todos: SessionTodo[] | null;
  /** Metadata for the latest persisted plan */
  plan: SessionPlanMetadata | null;
  pendingUserMessage: {
    /** A formatted UIMessage for display to the client. */
    message: UIMessage;
    /** Attachments to send with the message. Also found within UIMessage parts but here they are more easily accessible. */
    attachmentIds: string[];
  } | null;
  /** Active agent turn known by the server, even before any assistant chunks exist. */
  activeTurn: ActiveTurnState | null;
  /** Public URL for the VS Code editor (set when editor is open) */
  editorUrl: string | null;
  /** Auth connection state for the session's fixed provider */
  providerConnection: ProviderConnectionState | null;
  /** Agent operational mode: "edit" (default, full access) or "plan" (read-only exploration) */
  agentMode: AgentMode;
  /** Last error message from provisioning or agent start — reset on restart. Used moreso for persistent errors - use a stream event for a transient error */
  lastError: string | null;
  createdAt: Date;
};

export const AgentMode = z.enum(["edit", "plan"]);
export type AgentMode = z.infer<typeof AgentMode>;

/** Supported agent providers */
export const AgentProvider = ProviderId;
export type AgentProvider = z.infer<typeof AgentProvider>;

export { AgentSettings };

/** Partial settings for create/init requests; validated and merged in the DO */
export const AgentSettingsInput = z.object({
  provider: ProviderId.optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  maxTokens: z.number().optional(),
});
export type AgentSettingsInput = z.infer<typeof AgentSettingsInput>;

/** A chat message */
export const Message = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  toolCalls: z.array(z.unknown()).optional(),
  streamPosition: z.number().optional(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof Message>;

/** Summary of a session for the session list */
export const SessionSummary = z.object({
  id: z.uuid(),
  repoId: z.number(),
  repoFullName: z.string(),
  title: z.string().nullable(),
  archived: z.boolean(),
  workingState: SessionWorkingState,
  pushedBranch: z.string().nullable(),
  pullRequest: z.object({
    url: z.string(),
    number: z.number(),
    state: PullRequestState,
  }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().nullable(),
  lastAssistantMessageId: z.string().nullable(),
  hasUnread: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;
