import type { z } from "zod";
import { SessionSetupRun } from "../src/session";
import { ClientStateSchema } from "../src/client-state";
import { ListSessionsResponse } from "../src/sessions";
import { UIMessageSchema } from "../src/ui-message";
import { ClientMessage, ServerMessage } from "../src/websocket-api";
import { ModelsResponse } from "../src/models";
import { AgentSettings } from "../src/providers";

/**
 * Hand-written wire fixtures — realism the synthesizer can't invent.
 *
 * Structural coverage of every type and union variant comes from the
 * auto-synthesized fixtures (synthesize-fixtures.ts); these add realistic
 * payloads: actual AI SDK message parts, populated session state, and
 * schema-default materialization. Each is validated with `schema.parse` at
 * generation time and serialized from the PARSED value, matching the
 * output-mode JSON the server actually sends.
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

// Realistic AI SDK message: text + tool parts with deeply nested values.
const uiMessage = {
  id: "msg_1",
  role: "assistant",
  parts: [
    { type: "text", text: "Here is the plan." },
    {
      type: "tool-bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { command: "ls" },
      output: { stdout: "README.md\npackage.json" },
    },
  ],
  metadata: { custom: { deeply: ["nested", 42] } },
};

const sessionSetupRun = {
  id: "run_1",
  status: "running",
  startedAt: TIMESTAMP,
  completedAt: null,
  tasks: [
    {
      id: "cloud_container",
      isBlocking: true,
      canRetry: true,
      status: "completed",
      startedAt: TIMESTAMP,
      completedAt: TIMESTAMP_FRACTIONAL,
      error: null,
    },
    {
      id: "repository",
      isBlocking: true,
      canRetry: true,
      status: "running",
      startedAt: TIMESTAMP,
      completedAt: null,
      error: null,
    },
    {
      id: "setup_script",
      isBlocking: false,
      canRetry: false,
      status: "skipped",
      startedAt: null,
      completedAt: null,
      error: null,
      output: { stdout: "installed 120 packages", stderr: "", exitCode: 0, truncated: false },
      skipReason: { kind: "no_script", environmentId: ENVIRONMENT_ID, environmentName: "CI-like" },
    },
    {
      id: "network_policy",
      isBlocking: true,
      canRetry: true,
      status: "failed",
      startedAt: TIMESTAMP,
      completedAt: TIMESTAMP_FRACTIONAL,
      error: "policy apply failed",
    },
  ],
};

export const FIXTURES: Fixture[] = [
  { schema: UIMessageSchema, typeName: "WireUIMessage", caseName: "withParts", value: uiMessage },
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
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "syncResponse",
    value: {
      type: "sync.response",
      messages: [uiMessage],
      pendingChunks: [
        { type: "start", messageId: "msg_2" },
        { type: "text-start", id: "text_1" },
        { type: "text-delta", id: "text_1", delta: "Hel" },
      ],
      activeTurn: { userMessageId: "msg_1" },
    },
  },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "agentChunks",
    value: {
      type: "agent.chunks",
      chunks: [
        { type: "text-delta", id: "text_1", delta: "lo" },
        { type: "finish", finishReason: "stop" },
      ],
    },
  },
  {
    schema: ServerMessage,
    typeName: "ServerMessage",
    caseName: "agentFinish",
    value: { type: "agent.finish", message: uiMessage },
  },
  {
    schema: SessionSetupRun,
    typeName: "SessionSetupRun",
    caseName: "allTaskVariants",
    value: sessionSetupRun,
  },
  {
    schema: ClientStateSchema,
    typeName: "ClientState",
    caseName: "preparing",
    value: {
      repoFullName: "bedelstein/cloude-code",
      status: "preparing",
      sessionSetupRun,
      agentSettings: { provider: "claude-code" },
      pullRequest: { status: "creating" },
      pushedBranch: null,
      baseBranch: "main",
      todos: [{ content: "Scaffold API layer", status: "in_progress" }],
      plan: { lastUpdated: TIMESTAMP },
      pendingUserMessage: { message: uiMessage, attachmentIds: [ATTACHMENT_ID] },
      activeTurn: { userMessageId: "msg_1" },
      editorUrl: null,
      providerConnection: { provider: "claude-code", connected: true, requiresReauth: false },
      agentMode: "edit",
      lastError: null,
      createdAt: TIMESTAMP,
    },
  },
  // Schema defaults materialize through parse: {provider} → full settings.
  {
    schema: AgentSettings,
    typeName: "AgentSettings",
    caseName: "claudeDefaults",
    value: { provider: "claude-code" },
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
];
