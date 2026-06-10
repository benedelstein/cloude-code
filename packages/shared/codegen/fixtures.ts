import type { z } from "zod";
import {
  AgentSettingsInput,
  Message,
  PullRequestClientState,
  SessionSummary,
} from "../src/types/session";
import {
  CreateSessionRequest,
  CreateSessionResponse,
  DeleteSessionResponse,
  ListSessionsResponse,
  SessionInfoResponse,
} from "../src/types/api/sessions";
import { ClientMessage, ServerMessage, UIMessageSchema } from "../src/types/websocket-api";
import { UserSessionsServerMessage } from "../src/types/user-sessions-websocket-api";
import {
  ClaudeStatusResponse,
  OpenAIDeviceAttemptResponse,
  OpenAIDeviceStartResponse,
  TokenResponse,
} from "../src/types/api/auth";
import { Branch, Repo } from "../src/types/api/repos";
import { ModelsResponse } from "../src/types/api/models";
import { AttachmentDescriptor, UploadAttachmentResponse } from "../src/types/attachments";
import { AgentSettings } from "../src/types/providers/index";
import {
  CreateRepoEnvironmentRequest,
  NetworkAccessConfig,
  RepoEnvironment,
} from "../src/types/api/repo-environments";
import { VoiceTranscriptionTokenResponse } from "../src/types/api/voice";
import { IntegrationLinksResponse } from "../src/types/api/integrations";

/**
 * Cross-language wire fixtures.
 *
 * Each fixture is validated with `schema.parse` at generation time (so a
 * fixture that drifts from its schema fails the build) and serialized from
 * the PARSED value, so schema defaults are materialized — matching the
 * output-mode JSON the server actually sends. The generated Swift test
 * decodes each file, re-encodes it, and round-trips again; together with
 * parse-validation this is the proof that the TypeScript and Swift sides
 * agree on the wire format.
 */
export type Fixture = {
  schema: z.ZodType;
  /** Generated Swift type to decode as. */
  typeName: string;
  /** Distinguishes multiple fixtures of one type; used in the filename. */
  caseName: string;
  value: unknown;
};

const SESSION_ID = "5d2acbb1-9c60-4c8a-a45b-9914da9b625a";
const MESSAGE_ID = "0e9810b2-41b6-4c4a-8f3f-3a45f1e2b1aa";
const ENVIRONMENT_ID = "7f0f5c1d-91f1-4f93-b1de-3f37ad2b3a1c";
const ATTACHMENT_ID = "c1f8ed4e-2d8f-43a5-8a44-cdd2ce19f8f3";
const TIMESTAMP = "2026-06-09T12:00:00Z";
const TIMESTAMP_FRACTIONAL = "2026-06-09T12:00:00.123Z";

const sessionSummaryFull = {
  id: SESSION_ID,
  repoId: 123456,
  repoFullName: "bedelstein/cloude-code",
  title: "Fix login bug",
  archived: false,
  workingState: "responding",
  pushedBranch: "claude/fix-login",
  pullRequest: { url: "https://github.com/x/y/pull/7", number: 7, state: "open" },
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP_FRACTIONAL,
  lastMessageAt: TIMESTAMP,
  lastAssistantMessageId: MESSAGE_ID,
  hasUnread: true,
};

const sessionSummaryMinimal = {
  id: SESSION_ID,
  repoId: 123456,
  repoFullName: "bedelstein/cloude-code",
  title: null,
  archived: false,
  workingState: "idle",
  pushedBranch: null,
  pullRequest: null,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  lastMessageAt: null,
  lastAssistantMessageId: null,
  hasUnread: false,
};

const uiMessage = {
  id: "msg_1",
  role: "assistant",
  parts: [
    { type: "text", text: "Here is the plan." },
    { type: "tool-call", toolName: "bash", input: { command: "ls" }, nested: [1, 2.5, true, null] },
  ],
  metadata: { custom: { deeply: ["nested", 42] } },
};

export const FIXTURES: Fixture[] = [
  // Session core
  { schema: SessionSummary, typeName: "SessionSummary", caseName: "full", value: sessionSummaryFull },
  { schema: SessionSummary, typeName: "SessionSummary", caseName: "minimal", value: sessionSummaryMinimal },
  {
    schema: Message,
    typeName: "Message",
    caseName: "assistant",
    value: {
      id: MESSAGE_ID,
      sessionId: SESSION_ID,
      role: "assistant",
      content: "Done — the fix is pushed.",
      toolCalls: [{ name: "bash", arguments: { command: "pnpm test" } }],
      streamPosition: 17,
      createdAt: TIMESTAMP,
    },
  },
  {
    schema: PullRequestClientState,
    typeName: "PullRequestClientState",
    caseName: "creating",
    value: { status: "creating" },
  },
  {
    schema: PullRequestClientState,
    typeName: "PullRequestClientState",
    caseName: "failed",
    value: { status: "failed", error: "push rejected", details: "non-fast-forward" },
  },
  {
    schema: PullRequestClientState,
    typeName: "PullRequestClientState",
    caseName: "created",
    value: { status: "created", url: "https://github.com/x/y/pull/9", number: 9, state: "merged" },
  },
  {
    schema: AgentSettingsInput,
    typeName: "AgentSettingsInput",
    caseName: "partial",
    value: { model: "claude-fable-5" },
  },

  // Sessions API
  {
    schema: SessionInfoResponse,
    typeName: "SessionInfoResponse",
    caseName: "full",
    value: {
      sessionId: SESSION_ID,
      title: "Fix login bug",
      status: "ready",
      repoFullName: "bedelstein/cloude-code",
      baseBranch: "main",
      pushedBranch: "claude/fix-login",
      pullRequestUrl: "https://github.com/x/y/pull/7",
      pullRequestNumber: 7,
      pullRequestState: "open",
      editorUrl: "https://editor.example.com/s/abc",
    },
  },
  {
    schema: CreateSessionRequest,
    typeName: "CreateSessionRequest",
    caseName: "full",
    value: {
      repoId: 123456,
      environmentId: ENVIRONMENT_ID,
      settings: { provider: "claude-code", model: "claude-fable-5", effort: "max" },
      agentMode: "plan",
      branch: "main",
      initialMessage: { content: "Add dark mode", attachmentIds: [ATTACHMENT_ID] },
    },
  },
  {
    schema: CreateSessionResponse,
    typeName: "CreateSessionResponse",
    caseName: "created",
    value: {
      sessionId: SESSION_ID,
      title: null,
      websocketToken: "wst_abc123",
      websocketTokenExpiresAt: TIMESTAMP,
    },
  },
  {
    schema: ListSessionsResponse,
    typeName: "ListSessionsResponse",
    caseName: "paginated",
    value: {
      groups: [
        {
          repoId: 123456,
          repoFullName: "bedelstein/cloude-code",
          sessions: [sessionSummaryFull, sessionSummaryMinimal],
          nextSessionCursor: "cursor_1",
        },
      ],
      nextRepoCursor: null,
    },
  },
  { schema: DeleteSessionResponse, typeName: "DeleteSessionResponse", caseName: "deleted", value: { deleted: true } },

  // Session WebSocket protocol — every variant of both unions
  {
    schema: ClientMessage,
    typeName: "ClientMessage",
    caseName: "chatMessage",
    value: {
      type: "chat.message",
      content: "Run the tests",
      attachments: [{ attachmentId: ATTACHMENT_ID }],
      messageId: MESSAGE_ID,
      model: "claude-fable-5",
      effort: "high",
      agentMode: "edit",
    },
  },
  {
    schema: ClientMessage,
    typeName: "ClientMessage",
    caseName: "syncRequest",
    value: { type: "sync.request", lastMessageId: MESSAGE_ID, lastChunkIndex: 41 },
  },
  {
    schema: ClientMessage,
    typeName: "ClientMessage",
    caseName: "sessionMarkRead",
    value: { type: "session.mark_read", messageId: "msg_1" },
  },
  {
    schema: ClientMessage,
    typeName: "ClientMessage",
    caseName: "operationCancel",
    value: { type: "operation.cancel" },
  },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "connected",
    value: { type: "connected", sessionId: SESSION_ID, status: "ready", lastMessageId: MESSAGE_ID },
  },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "syncResponse",
    value: {
      type: "sync.response",
      messages: [uiMessage],
      pendingChunks: [{ type: "text-delta", delta: "Hel" }],
      activeTurn: { userMessageId: "msg_1" },
    },
  },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "operationError",
    value: { type: "operation.error", code: "GITHUB_AUTH_REQUIRED", message: "Reconnect GitHub" },
  },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "agentChunks",
    value: { type: "agent.chunks", chunks: [{ type: "text-delta", delta: "lo" }, { type: "finish" }] },
  },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "agentFinish",
    value: { type: "agent.finish", message: uiMessage },
  },
  { schema: ServerMessage, typeName: "ServerMessage", caseName: "agentReady", value: { type: "agent.ready" } },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "userMessage",
    value: { type: "user.message", message: { ...uiMessage, role: "user" } },
  },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "editorReady",
    value: { type: "editor.ready", url: "https://editor.example.com/s/abc", token: "edt_123" },
  },
  { schema: UIMessageSchema, typeName: "UIMessage", caseName: "withParts", value: uiMessage },

  // User-sessions WebSocket — every variant
  {
    schema: UserSessionsServerMessage,
    typeName: "UserSessionsServerMessage",
    caseName: "connected",
    value: { type: "user_sessions.connected" },
  },
  {
    schema: UserSessionsServerMessage,
    typeName: "UserSessionsServerMessage",
    caseName: "summaryCreated",
    value: { type: "session.summary.created", session: sessionSummaryMinimal },
  },
  {
    schema: UserSessionsServerMessage,
    typeName: "UserSessionsServerMessage",
    caseName: "summaryUpdated",
    value: { type: "session.summary.updated", session: sessionSummaryFull },
  },
  {
    schema: UserSessionsServerMessage,
    typeName: "UserSessionsServerMessage",
    caseName: "summaryRemoved",
    value: { type: "session.summary.removed", sessionId: SESSION_ID },
  },
  {
    schema: UserSessionsServerMessage,
    typeName: "UserSessionsServerMessage",
    caseName: "resyncRequired",
    value: { type: "session.list.resync_required" },
  },

  // Auth
  {
    schema: TokenResponse,
    typeName: "TokenResponse",
    caseName: "full",
    value: {
      token: "jwt_abc",
      user: { id: "u_1", login: "bedelstein", name: "Ben Edelstein", avatarUrl: null },
      hasInstallations: true,
      installUrl: "https://github.com/apps/cloude-code/installations/new",
    },
  },
  {
    schema: OpenAIDeviceStartResponse,
    typeName: "OpenAIDeviceStartResponse",
    caseName: "started",
    value: {
      attemptId: "att_1",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-1234",
      intervalSeconds: 5,
      expiresAt: TIMESTAMP,
    },
  },
  {
    schema: OpenAIDeviceAttemptResponse,
    typeName: "OpenAIDeviceAttemptResponse",
    caseName: "pending",
    value: { status: "pending" },
  },
  {
    schema: ClaudeStatusResponse,
    typeName: "ClaudeStatusResponse",
    caseName: "connected",
    value: { connected: true, requiresReauth: false, subscriptionType: "max", rateLimitTier: "tier-4" },
  },

  // Repos (reserved-word renames)
  {
    schema: Repo,
    typeName: "Repo",
    caseName: "private",
    value: {
      id: 123456,
      name: "cloude-code",
      fullName: "bedelstein/cloude-code",
      owner: "bedelstein",
      private: true,
      description: null,
      defaultBranch: "main",
    },
  },
  { schema: Branch, typeName: "Branch", caseName: "default", value: { name: "main", default: true } },

  // Models catalog
  {
    schema: ModelsResponse,
    typeName: "ModelsResponse",
    caseName: "catalog",
    value: {
      providers: [
        {
          providerId: "claude-code",
          providerName: "Claude Code",
          connected: true,
          requiresReauth: false,
          defaultModel: "claude-opus-4-8",
          defaultEffort: "high",
          authMethods: ["oauth"],
          models: [
            { id: "claude-fable-5", displayName: "Claude Fable 5", isDefault: false, selectable: true },
          ],
          efforts: [{ id: "high", displayName: "High", isDefault: true, selectable: true }],
          metadata: { beta: true },
        },
      ],
    },
  },

  // Attachments
  {
    schema: AttachmentDescriptor,
    typeName: "AttachmentDescriptor",
    caseName: "image",
    value: {
      attachmentId: ATTACHMENT_ID,
      filename: "screenshot.png",
      mediaType: "image/png",
      sizeBytes: 482113,
      createdAt: TIMESTAMP,
      sessionId: SESSION_ID,
      contentUrl: "https://files.example.com/a/c1f8ed4e",
    },
  },
  {
    schema: UploadAttachmentResponse,
    typeName: "UploadAttachmentResponse",
    caseName: "single",
    value: {
      attachments: [
        {
          attachmentId: ATTACHMENT_ID,
          filename: "notes.txt",
          mediaType: "text/plain",
          sizeBytes: 90,
          createdAt: TIMESTAMP,
          contentUrl: "https://files.example.com/a/c1f8ed4e",
        },
      ],
    },
  },

  // Providers — defaults materialize via parse
  {
    schema: AgentSettings,
    typeName: "AgentSettings",
    caseName: "claudeDefaults",
    value: { provider: "claude-code" },
  },
  {
    schema: AgentSettings,
    typeName: "AgentSettings",
    caseName: "codex",
    value: { provider: "openai-codex", model: "gpt-5.5", effort: "xhigh", maxTokens: 4096 },
  },

  // Repo environments — every NetworkAccessConfig mode
  { schema: NetworkAccessConfig, typeName: "NetworkAccessConfig", caseName: "open", value: { mode: "open" } },
  { schema: NetworkAccessConfig, typeName: "NetworkAccessConfig", caseName: "locked", value: { mode: "locked" } },
  { schema: NetworkAccessConfig, typeName: "NetworkAccessConfig", caseName: "default", value: { mode: "default" } },
  {
    schema: NetworkAccessConfig,
    typeName: "NetworkAccessConfig",
    caseName: "custom",
    value: { mode: "custom", extraAllowlist: ["api.example.com", "*.vercel.app"], includeDefaultAllowlist: true },
  },
  {
    schema: RepoEnvironment,
    typeName: "RepoEnvironment",
    caseName: "full",
    value: {
      id: ENVIRONMENT_ID,
      repoId: 123456,
      name: "CI-like",
      network: { mode: "custom", extraAllowlist: ["registry.npmjs.org"], includeDefaultAllowlist: true },
      plainEnvVars: { NODE_ENV: "test", CI: "1" },
      startupScript: "pnpm install",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP_FRACTIONAL,
    },
  },
  {
    schema: CreateRepoEnvironmentRequest,
    typeName: "CreateRepoEnvironmentRequest",
    caseName: "defaults",
    value: { name: "Default env", plainEnvVars: {} },
  },

  // Voice
  {
    schema: VoiceTranscriptionTokenResponse,
    typeName: "VoiceTranscriptionTokenResponse",
    caseName: "issued",
    value: { token: "vt_1", expiresAt: TIMESTAMP, maxBytes: 10485760 },
  },

  // Integrations
  {
    schema: IntegrationLinksResponse,
    typeName: "IntegrationLinksResponse",
    caseName: "linked",
    value: {
      links: [
        {
          provider: "discord",
          externalUserId: "98765",
          externalUsername: "ben#0001",
          expiresAt: TIMESTAMP,
          lastUsedAt: null,
        },
      ],
    },
  },
];
