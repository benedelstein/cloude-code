import "client-only";

import type {
  UserInfo,
  Repo,
  ListReposResponse,
  ListBranchesResponse,
  SearchReposResponse,
  CreateSessionInitialMessage,
  CreateSessionResponse,
  SessionWebSocketTokenResponse,
  UserSessionsWebSocketTokenResponse,
  DeleteSessionResponse,
  ArchiveSessionResponse,
  SessionInfoResponse,
  SessionPlanResponse,
  SessionSetupOutputResponse,
  ListSessionsResponse,
  SessionRepoGroup,
  SessionSummary,
  UpdateSessionTitleResponse,
  PullRequestResponse,
  PullRequestStatusResponse,
  GitHubAuthUrlResponse,
  GitHubReauthTokenResponse,
  LogoutResponse,
  OpenAIStatusResponse,
  OpenAIDisconnectResponse,
  OpenAIDeviceStartResponse,
  OpenAIDeviceAttemptResponse,
  ClaudeAuthUrlResponse,
  ClaudeTokenResponse,
  ClaudeStatusResponse,
  ClaudeDisconnectResponse,
  AgentSettingsInput,
  AgentMode,
  UploadAttachmentResponse,
  ModelsResponse,
  CreateRepoEnvironmentRequest,
  DefaultNetworkAllowlistResponse,
  ListRepoEnvironmentsResponse,
  ListUserRepoEnvironmentsResponse,
  RepoEnvironmentResponse,
  UpdateRepoEnvironmentRequest,
  UserRepoEnvironmentResponse,
  VoiceTranscriptionTokenResponse,
  IntegrationLinkClaimResponse,
  IntegrationLinkRevokeResponse,
  IntegrationLinksResponse,
  IntegrationProvider,
} from "@repo/shared";

// Re-export types that other modules import from this file
export type {
  UserInfo,
  Repo,
  CreateRepoEnvironmentRequest,
  UpdateRepoEnvironmentRequest,
  SessionSummary,
  SessionRepoGroup,
  ListSessionsResponse,
  PullRequestResponse,
  PullRequestStatusResponse,
};

// WebSocket URL still uses direct API URL (not proxied)
export const WS_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

// All REST calls go through the Next.js API proxy (same-origin, cookie-based auth)
const API_BASE = "/api";

// /auth/me 401s when there's no session — that's a normal "logged-out check"
// signal at boot, not a session expiration. Don't broadcast it.
const UNAUTHORIZED_SUPPRESSED_PATHS = new Set(["/auth/me"]);
const SESSION_PRESERVING_ERROR_CODES = new Set([
  "GITHUB_AUTH_REQUIRED",
  "GITHUB_UNAVAILABLE",
  "REPO_ACCESS_BLOCKED",
]);

// Dispatched on the window when any /api/* call returns 401 (except for the
// suppressed paths above). useAuth listens for this and clears user state.
export const AUTH_UNAUTHORIZED_EVENT = "auth:unauthorized";

type ApiErrorResponse = {
  error?: string;
  details?: string;
  code?: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    let code: string | undefined;
    let details: string | undefined;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await res.json() as ApiErrorResponse;
      message = body.error ?? body.details ?? message;
      code = body.code;
      details = body.details;
    } else {
      const text = await res.text();
      message = text || message;
    }

    if (res.status === 401 && message === `Request failed: ${res.status}`) {
      message = "Unauthorized";
    }

    // Notify the app shell that our session is no longer valid (e.g. user
    // revoked the GitHub App, or the session was deleted). Listened to by
    // useAuth, which clears local user state and surfaces the login flow.
    const shouldBroadcastUnauthorized =
      res.status === 401
      && typeof window !== "undefined"
      && !UNAUTHORIZED_SUPPRESSED_PATHS.has(path)
      && (code ? !SESSION_PRESERVING_ERROR_CODES.has(code) : true);
    if (shouldBroadcastUnauthorized) {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    }

    throw new ApiError(message, res.status, code, details);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function getCurrentUser(): Promise<UserInfo> {
  return apiFetch("/auth/me");
}

export async function listRepos(
  options: { cursor?: string; limit?: number } = {},
): Promise<ListReposResponse> {
  const params = new URLSearchParams();
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.limit) {
    params.set("limit", String(options.limit));
  }

  const query = params.size > 0 ? `?${params.toString()}` : "";
  return apiFetch(`/repos${query}`);
}

export async function searchRepos(
  query: string,
  options: { limit?: number } = {},
): Promise<SearchReposResponse> {
  const params = new URLSearchParams();
  params.set("q", query);
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  return apiFetch(`/repos/search?${params.toString()}`);
}

export async function listBranches(
  repoId: number,
  options: { cursor?: string } = {},
): Promise<ListBranchesResponse> {
  const params = new URLSearchParams();
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }

  const query = params.size > 0 ? `?${params.toString()}` : "";
  return apiFetch(`/repos/${repoId}/branches${query}`);
}

export async function createSession(
  repoId: number,
  initialMessage: CreateSessionInitialMessage,
  branch?: string,
  settings?: AgentSettingsInput,
  agentMode?: AgentMode,
  environmentId?: string,
): Promise<CreateSessionResponse> {
  return apiFetch("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoId,
      initialMessage,
      branch,
      settings,
      agentMode,
      environmentId,
    }),
  });
}

export async function listRepoEnvironments(
  repoId: number,
): Promise<ListRepoEnvironmentsResponse> {
  return apiFetch(`/repos/${repoId}/environments`);
}

export async function listUserRepoEnvironments(): Promise<ListUserRepoEnvironmentsResponse> {
  return apiFetch("/environments");
}

export async function getUserRepoEnvironment(
  environmentId: string,
): Promise<UserRepoEnvironmentResponse> {
  return apiFetch(`/environments/${environmentId}`);
}

export async function getDefaultNetworkAllowlist(): Promise<DefaultNetworkAllowlistResponse> {
  return apiFetch("/environments/default-allowlist");
}

export async function createRepoEnvironment(
  repoId: number,
  request: CreateRepoEnvironmentRequest,
): Promise<RepoEnvironmentResponse> {
  return apiFetch(`/repos/${repoId}/environments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function updateRepoEnvironment(
  repoId: number,
  environmentId: string,
  request: UpdateRepoEnvironmentRequest,
): Promise<RepoEnvironmentResponse> {
  return apiFetch(`/repos/${repoId}/environments/${environmentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function deleteRepoEnvironment(
  repoId: number,
  environmentId: string,
): Promise<void> {
  await apiFetch(`/repos/${repoId}/environments/${environmentId}`, {
    method: "DELETE",
  });
}

/**
 * Lists the current user's sessions, grouped by repo for the sidebar.
 *
 * - Default: paginated repo groups, each with up to `sessionLimit` sessions.
 *   Use `repoCursor` to fetch the next page of repo groups.
 * - With `repoId`: returns a single-group response for that one repo,
 *   paginated by `sessionCursor` (for "load more in this repo").
 */
export async function listSessions(opts?: {
  repoId?: number;
  repoCursor?: string;
  sessionCursor?: string;
  repoLimit?: number;
  sessionLimit?: number;
}): Promise<ListSessionsResponse> {
  const params = new URLSearchParams();
  if (opts?.repoId !== undefined) { params.set("repoId", String(opts.repoId)); }
  if (opts?.repoCursor) { params.set("repoCursor", opts.repoCursor); }
  if (opts?.sessionCursor) { params.set("sessionCursor", opts.sessionCursor); }
  if (opts?.repoLimit !== undefined) { params.set("repoLimit", String(opts.repoLimit)); }
  if (opts?.sessionLimit !== undefined) { params.set("sessionLimit", String(opts.sessionLimit)); }
  const query = params.toString();
  return apiFetch<ListSessionsResponse>(`/sessions${query ? `?${query}` : ""}`);
}

export async function getSession(sessionId: string): Promise<SessionInfoResponse> {
  return apiFetch(`/sessions/${sessionId}`);
}

export async function createSessionWebSocketToken(
  sessionId: string,
): Promise<SessionWebSocketTokenResponse> {
  return apiFetch(`/sessions/${sessionId}/websocket-token`, {
    method: "POST",
    cache: "no-store",
  });
}

export async function createUserSessionsWebSocketToken(): Promise<UserSessionsWebSocketTokenResponse> {
  return apiFetch("/sessions/updates/token", {
    method: "POST",
    cache: "no-store",
  });
}

export async function createVoiceTranscriptionToken(): Promise<VoiceTranscriptionTokenResponse> {
  return apiFetch("/voice/transcriptions/token", {
    method: "POST",
    cache: "no-store",
  });
}

export async function getSessionPlan(sessionId: string): Promise<SessionPlanResponse | null> {
  try {
    return await apiFetch(`/sessions/${sessionId}/plan`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getSessionSetupOutput(
  sessionId: string,
): Promise<SessionSetupOutputResponse | null> {
  try {
    return await apiFetch(`/sessions/${sessionId}/setup-output`, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function updateSessionTitle(
  sessionId: string,
  title: string,
): Promise<UpdateSessionTitleResponse> {
  return apiFetch(`/sessions/${sessionId}/title`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function createPullRequest(sessionId: string): Promise<PullRequestResponse> {
  return apiFetch(`/sessions/${sessionId}/pr`, { method: "POST" });
}

export async function getPullRequestStatus(sessionId: string): Promise<PullRequestStatusResponse> {
  return apiFetch(`/sessions/${sessionId}/pr`);
}

export async function deleteSession(sessionId: string): Promise<DeleteSessionResponse> {
  return apiFetch(`/sessions/${sessionId}`, { method: "DELETE" });
}

export async function archiveSession(sessionId: string): Promise<ArchiveSessionResponse> {
  return apiFetch(`/sessions/${sessionId}/archive`, { method: "POST" });
}

export async function uploadAttachments(
  files: File[],
  sessionId?: string,
): Promise<UploadAttachmentResponse> {
  const formData = new FormData();
  if (sessionId) {
    formData.append("sessionId", sessionId);
  }
  for (const file of files) {
    formData.append("files", file, file.name);
  }
  return apiFetch("/attachments", {
    method: "POST",
    body: formData,
  });
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  await apiFetch<void>(`/attachments/${attachmentId}`, { method: "DELETE" });
}

// GitHub OAuth
//
// Sign-in itself is a same-tab navigation through the BFF (`/api/auth/github/
// start`), so there is no client-side authorize-URL call. Reauthorization
// still runs in a popup for an already-authenticated user.
export async function startGitHubReauth(): Promise<GitHubAuthUrlResponse> {
  const origin = encodeURIComponent(window.location.origin);
  return apiFetch(`/auth/github/reauth/start?origin=${origin}`, { method: "POST" });
}

export async function exchangeGitHubReauth(
  code: string,
  state: string,
): Promise<GitHubReauthTokenResponse> {
  return apiFetch("/auth/github/reauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
}

export async function logoutUser(): Promise<LogoutResponse> {
  return apiFetch("/auth/logout", { method: "POST" });
}

export async function claimIntegrationLink(token: string): Promise<IntegrationLinkClaimResponse> {
  return apiFetch("/integrations/link/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export async function listIntegrationLinks(): Promise<IntegrationLinksResponse> {
  return apiFetch("/integrations/links");
}

export async function revokeIntegrationLink(
  provider: IntegrationProvider,
): Promise<IntegrationLinkRevokeResponse> {
  return apiFetch(`/integrations/links/${provider}`, { method: "DELETE" });
}

// OpenAI Codex device auth
export async function startOpenAIDeviceAuthorization(): Promise<OpenAIDeviceStartResponse> {
  return apiFetch("/auth/openai/device/start", { method: "POST" });
}

export async function pollOpenAIDeviceAuthorization(
  attemptId: string,
  sessionId?: string,
): Promise<OpenAIDeviceAttemptResponse> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return apiFetch(`/auth/openai/device/attempts/${attemptId}${query}`);
}

export async function getOpenAIStatus(): Promise<OpenAIStatusResponse> {
  return apiFetch("/auth/openai/status");
}

export async function disconnectOpenAI(): Promise<OpenAIDisconnectResponse> {
  return apiFetch("/auth/openai/disconnect", { method: "POST" });
}

// Models
export async function getModels(): Promise<ModelsResponse> {
  return apiFetch("/models");
}

// Claude OAuth
export async function getClaudeAuthUrl(): Promise<ClaudeAuthUrlResponse> {
  return apiFetch("/auth/claude");
}

export async function exchangeClaudeCode(
  code: string,
  state: string,
  sessionId?: string,
): Promise<ClaudeTokenResponse> {
  return apiFetch("/auth/claude/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state, sessionId }),
  });
}

export async function getClaudeStatus(): Promise<ClaudeStatusResponse> {
  return apiFetch("/auth/claude/status");
}

export async function disconnectClaude(): Promise<ClaudeDisconnectResponse> {
  return apiFetch("/auth/claude/disconnect", { method: "POST" });
}
