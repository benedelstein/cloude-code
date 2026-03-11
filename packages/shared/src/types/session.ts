import { z } from "zod";

export const SessionStatus = z.enum([
  /** Provisioning the session */
  "provisioning",
  /** Cloning the repository */
  "cloning",
  /** Syncing the repository via git */
  "syncing",
  /** Attaching to the agent process running on the vm */
  "attaching",
  /** Waking up the vm */
  "waking",
  /** Hibernating the vm */
  "hibernating",
  /** Error occurred */
  "error",
  /** Session is terminated. No more messages can be sent or received. */
  "terminated",
  /** Ready to send and receive messages */
  "ready",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export type PullRequestState = "open" | "merged" | "closed";

/** State managed by the SessionAgentDO, synced to clients via Cloudflare Agents */
export type AgentState = {
  sessionId: string | null;
  userId: string | null;
  repoFullName: string | null;
  spriteName: string | null;
  /** Session ID given by the Claude Agent SDK */
  claudeSessionId: string | null;
  /** ID of the agent process session running on the sprite */
  agentProcessId: number | null;
  status: SessionStatus;
  settings: SessionSettings;
  /** Branch name locked after first push (for "Create PR" flow) */
  pushedBranch: string | null;
  /** GitHub PR URL after creation */
  pullRequestUrl: string | null;
  /** GitHub PR number for API lookups */
  pullRequestNumber: number | null;
  /** PR state: open, merged, or closed */
  pullRequestState: PullRequestState | null;
  /** Message to send automatically once provisioning completes */
  pendingMessage: string | null;
  /** Attachment IDs to send with the pending initial message */
  pendingAttachmentIds: string[];
  /** Public URL for the VS Code editor (set when editor is open) */
  editorUrl: string | null;
  /** Branch the session was based off — used as the PR target */
  baseBranch: string | null;
  createdAt: Date;
};

/** Supported agent providers */
export const AgentProvider = z.enum(["claude-code", "codex-cli"]);
export type AgentProvider = z.infer<typeof AgentProvider>;
export const CodexModel = z.enum([
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
]);
export type CodexModel = z.infer<typeof CodexModel>;

export const ClaudeModel = z.enum([
  "opus",
  "sonnet",
  "haiku",
]);
export type ClaudeModel = z.infer<typeof ClaudeModel>;

const SessionSettingsCodex = z.object({
  provider: z.literal("codex-cli"),
  model: CodexModel.default("gpt-5.3-codex"),
  maxTokens: z.number().default(8192),
});

const SessionSettingsClaude = z.object({
  provider: z.literal("claude-code"),
  model: ClaudeModel.default("opus"),
  maxTokens: z.number().default(8192),
});

export const SessionSettings = z.discriminatedUnion("provider", [
  SessionSettingsCodex,
  SessionSettingsClaude,
]);
export type SessionSettings = z.infer<typeof SessionSettings>;

/** Partial settings for create/init requests; validated and merged in the DO */
export const SessionSettingsInput = z.object({
  provider: AgentProvider.optional(),
  model: z.string().optional(),
  maxTokens: z.number().optional(),
});
export type SessionSettingsInput = z.infer<typeof SessionSettingsInput>;

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

export const ToolCall = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
  output: z.string().nullable(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  createdAt: z.iso.datetime(),
});
export type ToolCall = z.infer<typeof ToolCall>;

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

export const SpriteCheckpoint = z.object({
  id: z.string(),
  sessionId: z.uuid(),
  version: z.number(),
  gitCommitSha: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type SpriteCheckpoint = z.infer<typeof SpriteCheckpoint>;
