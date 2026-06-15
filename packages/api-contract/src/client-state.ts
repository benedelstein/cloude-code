import { z } from "zod";
import {
  ActiveTurnState,
  AgentMode,
  PullRequestClientState,
  ProviderConnectionState,
  SessionPlanMetadata,
  SessionSetupRun,
  SessionStatus,
  SessionTodo,
} from "./session";
import { AgentSettings } from "./providers";
import { WireUIMessageSchema } from "./ui-message";

export const PendingUserMessage = z.object({
  message: WireUIMessageSchema.describe("A formatted UIMessage for display to the client."),
  attachmentIds: z.array(z.string())
    .describe("Also found within UIMessage parts, but more easily accessible here."),
});
export type PendingUserMessage = z.infer<typeof PendingUserMessage>;

/**
 * Durable session state synced to clients via the Cloudflare Agents SDK.
 * IMPORTANT: ClientState IS PROPAGATED TO CLIENTS. DO NOT PUT SENSITIVE DATA HERE.
 *
 * Fields marked "reset on restart" are overwritten in the DO constructor so
 * they never get stuck from a previous instance's in-progress operation.
 */
export const ClientStateSchema = z.object({
  repoFullName: z.string().nullable(),
  /** Synthesized from ServerState checkpoints — reset on restart. */
  status: SessionStatus,
  sessionSetupRun: SessionSetupRun.nullable()
    .describe("Public setup checklist shown while a session is preparing."),
  agentSettings: AgentSettings,
  pullRequest: PullRequestClientState.nullable(),
  pushedBranch: z.string().nullable()
    .describe("Branch name locked after first push (for the Create PR flow)."),
  baseBranch: z.string().nullable()
    .describe("Branch the session was based off — used as the PR target."),
  todos: z.array(SessionTodo).nullable()
    .describe("Latest streamed todo snapshot from the provider todo tool."),
  plan: SessionPlanMetadata.nullable(),
  pendingUserMessage: PendingUserMessage.nullable(),
  activeTurn: ActiveTurnState.nullable()
    .describe("Active agent turn known by the server, even before any assistant chunks exist."),
  editorUrl: z.string().nullable()
    .describe("Public URL for the VS Code editor (set when the editor is open)."),
  providerConnection: ProviderConnectionState.nullable(),
  agentMode: AgentMode,
  /** Last persistent error from provisioning or agent start — reset on restart. */
  lastError: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ClientState = z.infer<typeof ClientStateSchema>;
