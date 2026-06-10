import type { ManifestEntry } from "./ir";
import {
  AgentMode,
  AgentSettingsInput,
  Message,
  PullRequestClientState,
  PullRequestState,
  SessionAccessBlockReason,
  SessionPlanMetadata,
  SessionStatus,
  SessionSummary,
  SessionTodo,
  SessionTodoStatus,
  SessionWorkingState,
} from "../src/types/session";
import {
  ArchiveSessionResponse,
  CreateSessionInitialMessage,
  CreateSessionRequest,
  CreateSessionResponse,
  DeleteSessionResponse,
  ListSessionsResponse,
  PullRequestResponse,
  PullRequestStatusResponse,
  SessionInfoResponse,
  SessionPlanResponse,
  SessionRepoGroup,
  SessionWebSocketTokenResponse,
  UpdateSessionTitleRequest,
  UpdateSessionTitleResponse,
  UserSessionsWebSocketTokenResponse,
} from "../src/types/api/sessions";
import {
  AgentChunksEvent,
  AgentFinishEvent,
  AgentReadyEvent,
  ChatMessageEvent,
  ClientMessage,
  ConnectedEvent,
  EditorReadyEvent,
  OperationCancelEvent,
  OperationErrorCode,
  OperationErrorEvent,
  ServerMessage,
  SessionMarkReadEvent,
  SyncRequestEvent,
  SyncResponseEvent,
  UIMessageSchema,
  UserMessageEvent,
} from "../src/types/websocket-api";
import {
  SessionListResyncRequiredEvent,
  SessionSummaryCreatedEvent,
  SessionSummaryRemovedEvent,
  SessionSummaryUpdatedEvent,
  UserSessionsConnectedEvent,
  UserSessionsServerMessage,
} from "../src/types/user-sessions-websocket-api";
import {
  ClaudeAuthUrlResponse,
  ClaudeDisconnectResponse,
  ClaudeStatusResponse,
  ClaudeTokenRequest,
  ClaudeTokenResponse,
  GitHubAuthUrlResponse,
  GitHubReauthTokenResponse,
  LogoutResponse,
  OpenAIAuthUrlResponse,
  OpenAIDeviceAttemptResponse,
  OpenAIDeviceStartResponse,
  OpenAIDisconnectResponse,
  OpenAIStatusResponse,
  OpenAITokenRequest,
  OpenAITokenResponse,
  TokenRequest,
  TokenResponse,
  UserInfo,
} from "../src/types/api/auth";
import {
  Branch,
  ListBranchesResponse,
  ListReposResponse,
  Repo,
  SearchReposResponse,
} from "../src/types/api/repos";
import {
  ModelsResponse,
  ProviderCatalogEffort,
  ProviderCatalogEntry,
  ProviderCatalogModel,
} from "../src/types/api/models";
import {
  AttachmentDescriptor,
  MessageAttachmentRef,
  UploadAttachmentResponse,
} from "../src/types/attachments";
import {
  AgentSettings,
  AgentSettingsClaude,
  AgentSettingsCodex,
  AuthMethod,
  ClaudeEffort,
  ClaudeModel,
  OpenAICodexEffort,
  OpenAICodexModel,
  ProviderId,
} from "../src/types/providers/index";
import {
  CreateRepoEnvironmentRequest,
  DefaultNetworkAllowlistResponse,
  DeleteRepoEnvironmentResponse,
  ListRepoEnvironmentsResponse,
  ListUserRepoEnvironmentsResponse,
  NetworkAccessConfig,
  PlainEnvVars,
  RepoEnvironment,
  RepoEnvironmentResponse,
  RepoEnvironmentSummary,
  UpdateRepoEnvironmentRequest,
  UserRepoEnvironmentResponse,
} from "../src/types/api/repo-environments";
import {
  VoiceTranscriptionResponse,
  VoiceTranscriptionTokenResponse,
} from "../src/types/api/voice";
import {
  IntegrationLinkClaimRequest,
  IntegrationLinkClaimResponse,
  IntegrationLinkInfo,
  IntegrationLinkRevokeResponse,
  IntegrationLinksResponse,
  IntegrationProvider,
} from "../src/types/api/integrations";

/**
 * Every schema transpiled into the CoreAPI Swift package, in emission order.
 * One generated Swift file per group. See docs/api-type-codegen.md for the
 * full guide to adding types and how the transpiler works.
 *
 * Inclusion is deliberate (not export-walking): server-internal schemas
 * (vm-agent protocol, webhook bodies, bot-integration session creation) stay
 * out of the iOS surface.
 *
 * `nonFrozen` marks server-evolving vocabularies: decoding an unrecognized
 * value yields `.unknown` instead of throwing, so already-shipped app builds
 * survive server additions.
 */
export const MANIFEST: ManifestEntry[] = [
  // --- Session core -------------------------------------------------------
  { schema: SessionStatus, swiftName: "SessionStatus", group: "Session", nonFrozen: true },
  { schema: SessionWorkingState, swiftName: "SessionWorkingState", group: "Session", nonFrozen: true },
  { schema: PullRequestState, swiftName: "PullRequestState", group: "Session", nonFrozen: true },
  { schema: PullRequestClientState, swiftName: "PullRequestClientState", group: "Session", nonFrozen: true },
  { schema: SessionAccessBlockReason, swiftName: "SessionAccessBlockReason", group: "Session", nonFrozen: true },
  { schema: SessionTodoStatus, swiftName: "SessionTodoStatus", group: "Session", nonFrozen: true },
  { schema: SessionTodo, swiftName: "SessionTodo", group: "Session" },
  { schema: SessionPlanMetadata, swiftName: "SessionPlanMetadata", group: "Session" },
  { schema: AgentMode, swiftName: "AgentMode", group: "Session", nonFrozen: true },
  { schema: AgentSettingsInput, swiftName: "AgentSettingsInput", group: "Session" },
  { schema: Message, swiftName: "Message", group: "Session" },
  { schema: SessionSummary, swiftName: "SessionSummary", group: "Session" },

  // --- Sessions API -------------------------------------------------------
  { schema: SessionInfoResponse, swiftName: "SessionInfoResponse", group: "SessionsAPI" },
  { schema: SessionPlanResponse, swiftName: "SessionPlanResponse", group: "SessionsAPI" },
  { schema: CreateSessionInitialMessage, swiftName: "CreateSessionInitialMessage", group: "SessionsAPI" },
  { schema: CreateSessionRequest, swiftName: "CreateSessionRequest", group: "SessionsAPI" },
  { schema: CreateSessionResponse, swiftName: "CreateSessionResponse", group: "SessionsAPI" },
  { schema: SessionWebSocketTokenResponse, swiftName: "SessionWebSocketTokenResponse", group: "SessionsAPI" },
  { schema: UserSessionsWebSocketTokenResponse, swiftName: "UserSessionsWebSocketTokenResponse", group: "SessionsAPI" },
  { schema: UpdateSessionTitleRequest, swiftName: "UpdateSessionTitleRequest", group: "SessionsAPI" },
  { schema: UpdateSessionTitleResponse, swiftName: "UpdateSessionTitleResponse", group: "SessionsAPI" },
  { schema: SessionRepoGroup, swiftName: "SessionRepoGroup", group: "SessionsAPI" },
  { schema: ListSessionsResponse, swiftName: "ListSessionsResponse", group: "SessionsAPI" },
  { schema: PullRequestResponse, swiftName: "PullRequestResponse", group: "SessionsAPI" },
  { schema: PullRequestStatusResponse, swiftName: "PullRequestStatusResponse", group: "SessionsAPI" },
  { schema: DeleteSessionResponse, swiftName: "DeleteSessionResponse", group: "SessionsAPI" },
  { schema: ArchiveSessionResponse, swiftName: "ArchiveSessionResponse", group: "SessionsAPI" },

  // --- Session WebSocket protocol ------------------------------------------
  { schema: ChatMessageEvent, swiftName: "ChatMessageEvent", group: "WebSocket" },
  { schema: SyncRequestEvent, swiftName: "SyncRequestEvent", group: "WebSocket" },
  { schema: SessionMarkReadEvent, swiftName: "SessionMarkReadEvent", group: "WebSocket" },
  { schema: OperationCancelEvent, swiftName: "OperationCancelEvent", group: "WebSocket" },
  {
    schema: ClientMessage,
    swiftName: "ClientMessage",
    group: "WebSocket",
    doc: "Client → server session WebSocket messages.",
  },
  { schema: UIMessageSchema, swiftName: "UIMessage", group: "WebSocket", doc: "Wire shape of an AI SDK UIMessage; parts stay opaque JSON." },
  { schema: ConnectedEvent, swiftName: "ConnectedEvent", group: "WebSocket" },
  { schema: SyncResponseEvent, swiftName: "SyncResponseEvent", group: "WebSocket" },
  { schema: OperationErrorCode, swiftName: "OperationErrorCode", group: "WebSocket", nonFrozen: true },
  { schema: OperationErrorEvent, swiftName: "OperationErrorEvent", group: "WebSocket" },
  { schema: AgentChunksEvent, swiftName: "AgentChunksEvent", group: "WebSocket" },
  { schema: AgentFinishEvent, swiftName: "AgentFinishEvent", group: "WebSocket" },
  { schema: AgentReadyEvent, swiftName: "AgentReadyEvent", group: "WebSocket" },
  { schema: UserMessageEvent, swiftName: "UserMessageEvent", group: "WebSocket" },
  { schema: EditorReadyEvent, swiftName: "EditorReadyEvent", group: "WebSocket" },
  {
    schema: ServerMessage,
    swiftName: "ServerMessage",
    group: "WebSocket",
    nonFrozen: true,
    doc: "Server → client session WebSocket messages.",
  },

  // --- User-sessions WebSocket protocol ------------------------------------
  { schema: UserSessionsConnectedEvent, swiftName: "UserSessionsConnectedEvent", group: "UserSessionsWebSocket" },
  { schema: SessionSummaryCreatedEvent, swiftName: "SessionSummaryCreatedEvent", group: "UserSessionsWebSocket" },
  { schema: SessionSummaryUpdatedEvent, swiftName: "SessionSummaryUpdatedEvent", group: "UserSessionsWebSocket" },
  { schema: SessionSummaryRemovedEvent, swiftName: "SessionSummaryRemovedEvent", group: "UserSessionsWebSocket" },
  { schema: SessionListResyncRequiredEvent, swiftName: "SessionListResyncRequiredEvent", group: "UserSessionsWebSocket" },
  {
    schema: UserSessionsServerMessage,
    swiftName: "UserSessionsServerMessage",
    group: "UserSessionsWebSocket",
    nonFrozen: true,
    doc: "Server → client messages on the user-level sessions WebSocket.",
  },

  // --- Auth -----------------------------------------------------------------
  { schema: UserInfo, swiftName: "UserInfo", group: "Auth" },
  { schema: GitHubAuthUrlResponse, swiftName: "GitHubAuthUrlResponse", group: "Auth" },
  { schema: TokenRequest, swiftName: "TokenRequest", group: "Auth" },
  { schema: TokenResponse, swiftName: "TokenResponse", group: "Auth" },
  { schema: LogoutResponse, swiftName: "LogoutResponse", group: "Auth" },
  { schema: GitHubReauthTokenResponse, swiftName: "GitHubReauthTokenResponse", group: "Auth" },
  { schema: OpenAIAuthUrlResponse, swiftName: "OpenAIAuthUrlResponse", group: "Auth" },
  { schema: OpenAITokenRequest, swiftName: "OpenAITokenRequest", group: "Auth" },
  { schema: OpenAITokenResponse, swiftName: "OpenAITokenResponse", group: "Auth" },
  { schema: OpenAIStatusResponse, swiftName: "OpenAIStatusResponse", group: "Auth" },
  { schema: OpenAIDisconnectResponse, swiftName: "OpenAIDisconnectResponse", group: "Auth" },
  { schema: OpenAIDeviceStartResponse, swiftName: "OpenAIDeviceStartResponse", group: "Auth" },
  { schema: OpenAIDeviceAttemptResponse, swiftName: "OpenAIDeviceAttemptResponse", group: "Auth" },
  { schema: ClaudeAuthUrlResponse, swiftName: "ClaudeAuthUrlResponse", group: "Auth" },
  { schema: ClaudeTokenRequest, swiftName: "ClaudeTokenRequest", group: "Auth" },
  { schema: ClaudeTokenResponse, swiftName: "ClaudeTokenResponse", group: "Auth" },
  { schema: ClaudeStatusResponse, swiftName: "ClaudeStatusResponse", group: "Auth" },
  { schema: ClaudeDisconnectResponse, swiftName: "ClaudeDisconnectResponse", group: "Auth" },

  // --- Repos ----------------------------------------------------------------
  {
    schema: Repo,
    swiftName: "Repo",
    group: "Repos",
    renames: { private: "isPrivate" },
  },
  { schema: ListReposResponse, swiftName: "ListReposResponse", group: "Repos" },
  { schema: SearchReposResponse, swiftName: "SearchReposResponse", group: "Repos" },
  {
    schema: Branch,
    swiftName: "Branch",
    group: "Repos",
    renames: { default: "isDefault" },
  },
  { schema: ListBranchesResponse, swiftName: "ListBranchesResponse", group: "Repos" },

  // --- Models catalog ---------------------------------------------------------
  { schema: ProviderCatalogModel, swiftName: "ProviderCatalogModel", group: "Models" },
  { schema: ProviderCatalogEffort, swiftName: "ProviderCatalogEffort", group: "Models" },
  { schema: ProviderCatalogEntry, swiftName: "ProviderCatalogEntry", group: "Models" },
  { schema: ModelsResponse, swiftName: "ModelsResponse", group: "Models" },

  // --- Attachments ------------------------------------------------------------
  { schema: MessageAttachmentRef, swiftName: "MessageAttachmentRef", group: "Attachments" },
  { schema: AttachmentDescriptor, swiftName: "AttachmentDescriptor", group: "Attachments" },
  { schema: UploadAttachmentResponse, swiftName: "UploadAttachmentResponse", group: "Attachments" },

  // --- Providers ----------------------------------------------------------------
  { schema: ProviderId, swiftName: "ProviderId", group: "Providers", nonFrozen: true },
  { schema: AuthMethod, swiftName: "AuthMethod", group: "Providers", nonFrozen: true },
  { schema: ClaudeModel, swiftName: "ClaudeModel", group: "Providers", nonFrozen: true },
  { schema: ClaudeEffort, swiftName: "ClaudeEffort", group: "Providers", nonFrozen: true },
  { schema: AgentSettingsClaude, swiftName: "AgentSettingsClaude", group: "Providers" },
  { schema: OpenAICodexModel, swiftName: "OpenAICodexModel", group: "Providers", nonFrozen: true },
  { schema: OpenAICodexEffort, swiftName: "OpenAICodexEffort", group: "Providers", nonFrozen: true },
  { schema: AgentSettingsCodex, swiftName: "AgentSettingsCodex", group: "Providers" },
  {
    schema: AgentSettings,
    swiftName: "AgentSettings",
    group: "Providers",
    nonFrozen: true,
    doc: "Active agent settings, discriminated by provider.",
  },

  // --- Repo environments ------------------------------------------------------
  { schema: NetworkAccessConfig, swiftName: "NetworkAccessConfig", group: "RepoEnvironments", nonFrozen: true },
  { schema: PlainEnvVars, swiftName: "PlainEnvVars", group: "RepoEnvironments" },
  { schema: RepoEnvironment, swiftName: "RepoEnvironment", group: "RepoEnvironments" },
  { schema: RepoEnvironmentSummary, swiftName: "RepoEnvironmentSummary", group: "RepoEnvironments" },
  { schema: ListRepoEnvironmentsResponse, swiftName: "ListRepoEnvironmentsResponse", group: "RepoEnvironments" },
  { schema: ListUserRepoEnvironmentsResponse, swiftName: "ListUserRepoEnvironmentsResponse", group: "RepoEnvironments" },
  { schema: DefaultNetworkAllowlistResponse, swiftName: "DefaultNetworkAllowlistResponse", group: "RepoEnvironments" },
  { schema: UserRepoEnvironmentResponse, swiftName: "UserRepoEnvironmentResponse", group: "RepoEnvironments" },
  { schema: CreateRepoEnvironmentRequest, swiftName: "CreateRepoEnvironmentRequest", group: "RepoEnvironments" },
  { schema: UpdateRepoEnvironmentRequest, swiftName: "UpdateRepoEnvironmentRequest", group: "RepoEnvironments" },
  { schema: RepoEnvironmentResponse, swiftName: "RepoEnvironmentResponse", group: "RepoEnvironments" },
  { schema: DeleteRepoEnvironmentResponse, swiftName: "DeleteRepoEnvironmentResponse", group: "RepoEnvironments" },

  // --- Voice --------------------------------------------------------------------
  { schema: VoiceTranscriptionTokenResponse, swiftName: "VoiceTranscriptionTokenResponse", group: "Voice" },
  { schema: VoiceTranscriptionResponse, swiftName: "VoiceTranscriptionResponse", group: "Voice" },

  // --- Integrations (link management only; bot APIs are not an iOS surface) ----
  { schema: IntegrationProvider, swiftName: "IntegrationProvider", group: "Integrations", nonFrozen: true },
  { schema: IntegrationLinkClaimRequest, swiftName: "IntegrationLinkClaimRequest", group: "Integrations" },
  { schema: IntegrationLinkClaimResponse, swiftName: "IntegrationLinkClaimResponse", group: "Integrations" },
  { schema: IntegrationLinkInfo, swiftName: "IntegrationLinkInfo", group: "Integrations" },
  { schema: IntegrationLinksResponse, swiftName: "IntegrationLinksResponse", group: "Integrations" },
  { schema: IntegrationLinkRevokeResponse, swiftName: "IntegrationLinkRevokeResponse", group: "Integrations" },
];
