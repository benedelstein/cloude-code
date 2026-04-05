import type { UIMessage } from "ai";
import { z } from "zod";
import {
  ProviderId,
  AgentSettings,
} from "./providers/index";

export const SessionStatus = z.enum([
  /** DO initialized but handleInit not yet called */
  "initializing",
  /** Provisioning the sprite VM */
  "provisioning",
  /** Cloning the repository onto the sprite */
  "cloning",
  /** Attaching to the agent process running on the vm */
  "attaching",
  /** Ready to send and receive messages */
  "ready",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export type PullRequestState = "open" | "merged" | "closed";

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
  agentSettings: AgentSettings;
  pullRequest: {
    url: string;
    number: number;
    state: PullRequestState;
  } | null;
  /** Branch name locked after first push (for "Create PR" flow) */
  pushedBranch: string | null;
  /** Branch the session was based off — used as the PR target */
  baseBranch: string | null;
  /** Latest streamed todo snapshot from TodoWrite */
  todos: SessionTodo[] | null;
  /** Metadata for the latest persisted plan */
  plan: SessionPlanMetadata | null;
  pendingUserMessage: {
    /** A formatted UIMessage for display to the client. */
    message: UIMessage;
    /** Attachments to send with the message. Also found within UIMessage parts but here they are more easily accessible. */
    attachmentIds: string[];
  } | null;
  /** Public URL for the VS Code editor (set when editor is open) */
  editorUrl: string | null;
  /** Agent operational mode: "edit" (default, full access) or "plan" (read-only exploration) */
  agentMode: AgentMode;
  /** Whether the agent is currently responding to a message — reset on restart */
  isResponding: boolean;
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
  provider: AgentProvider.optional(),
  model: z.string().optional(),
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
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;
