import { z } from "zod";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "./attachments";
import {
  AgentMode,
  AgentSettingsInput,
  PullRequestState,
  SessionStatus,
  SessionSummary,
} from "./session";

/** Minimal session info returned by API */
export const SessionInfoResponse = z.object({
  sessionId: z.uuid(),
  title: z.string().nullable(),
  status: SessionStatus.describe(
    "preparing: setup in progress; setup_failed: setup blocked by a failure; ready: accepting messages",
  ),
  repoFullName: z.string().describe("GitHub repo in owner/name form"),
  baseBranch: z.string().optional().describe("Branch the session was started from"),
  pushedBranch: z.string().optional().describe("Branch the agent pushed its work to, if any"),
  pullRequestUrl: z.string().optional(),
  pullRequestNumber: z.number().int().optional(),
  pullRequestState: PullRequestState.optional(),
  editorUrl: z.string().optional().describe("URL of the session's browser-based code editor, if available"),
});
export type SessionInfoResponse = z.infer<typeof SessionInfoResponse>;

export const SessionPlanResponse = z.object({
  plan: z.string(),
  updatedAt: z.iso.datetime(),
  sourceMessageId: z.string().nullable(),
});
export type SessionPlanResponse = z.infer<typeof SessionPlanResponse>;

/** Full accumulated setup-script output, fetched on demand. */
export const SessionSetupOutputResponse = z.object({
  taskId: z.literal("setup_script"),
  /**
   * Identifies the script run the output belongs to. Matches the epoch on
   * streamed setup.output.chunks events from the same server instance; may
   * differ for completed runs after a server restart.
   */
  epoch: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean().describe("True when output hit the per-stream storage cap"),
  completed: z.boolean().describe("False while the script is still running"),
});
export type SessionSetupOutputResponse = z.infer<typeof SessionSetupOutputResponse>;

export const CreateSessionInitialMessage = z.object({
  content: z.string().trim().min(1).optional().describe("Initial text content for the session"),
  attachmentIds: z.array(z.uuid())
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional()
    .describe("Uploaded attachment IDs to bind to the initial message"),
}).superRefine((value, context) => {
  const hasContent = Boolean(value.content);
  const hasAttachments = (value.attachmentIds?.length ?? 0) > 0;
  if (!hasContent && !hasAttachments) {
    context.addIssue({
      code: "custom",
      message: "initialMessage must include content or attachments",
    });
  }
});
export type CreateSessionInitialMessage = z.infer<typeof CreateSessionInitialMessage>;

export const CreateSessionRequest = z.object({
  /** Numeric GitHub repo ID */
  repoId: z.number().int().describe("Numeric GitHub repo ID"),
  environmentId: z.uuid().optional().describe("Optional repo environment to snapshot for session setup"),
  settings: AgentSettingsInput.optional().describe("Agent settings"),
  agentMode: AgentMode.optional().describe("Agent operational mode"),
  branch: z.string().min(1).optional().describe("Optional branch to base the session on (defaults to repo's default branch)"),
  initialMessage: CreateSessionInitialMessage.describe("Initial user message to send immediately after session creation"),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const CreateSessionResponse = z.object({
  sessionId: z.uuid(),
  title: z.string().nullable(),
  websocketToken: z.string().describe("Short-lived token for the session WebSocket stream"),
  websocketTokenExpiresAt: z.iso.datetime(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

export const SessionWebSocketTokenResponse = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});
export type SessionWebSocketTokenResponse = z.infer<
  typeof SessionWebSocketTokenResponse
>;

export const UserSessionsWebSocketTokenResponse = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
});
export type UserSessionsWebSocketTokenResponse = z.infer<
  typeof UserSessionsWebSocketTokenResponse
>;

export const UpdateSessionTitleRequest = z.object({
  title: z.string().trim().min(1).max(60),
});
export type UpdateSessionTitleRequest = z.infer<typeof UpdateSessionTitleRequest>;

export const UpdateSessionTitleResponse = z.object({
  title: z.string(),
});
export type UpdateSessionTitleResponse = z.infer<typeof UpdateSessionTitleResponse>;

/** One repo's group of sessions in the sidebar response. */
export const SessionRepoGroup = z.object({
  repoId: z.number().int(),
  repoFullName: z.string(),
  sessions: z.array(SessionSummary),
  nextSessionCursor: z.string().nullable()
    .describe("Cursor to fetch the next page of sessions within this repo, or null if none"),
});
export type SessionRepoGroup = z.infer<typeof SessionRepoGroup>;

/** Paginated response for GET /sessions — sessions grouped by repo. */
export const ListSessionsResponse = z.object({
  groups: z.array(SessionRepoGroup),
  nextRepoCursor: z.string().nullable()
    .describe("Cursor to fetch the next page of repo groups, or null if none"),
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponse>;

export const PullRequestResponse = z.object({
  url: z.string(),
  number: z.number().int(),
  state: z.string(),
});
export type PullRequestResponse = z.infer<typeof PullRequestResponse>;

export const PullRequestStatusResponse = z.object({
  url: z.string(),
  number: z.number().int(),
  state: z.string(),
  merged: z.boolean(),
});
export type PullRequestStatusResponse = z.infer<
  typeof PullRequestStatusResponse
>;

export const DeleteSessionResponse = z.object({
  deleted: z.literal(true),
});
export type DeleteSessionResponse = z.infer<typeof DeleteSessionResponse>;

export const ArchiveSessionResponse = z.object({
  archived: z.literal(true),
});
export type ArchiveSessionResponse = z.infer<typeof ArchiveSessionResponse>;
