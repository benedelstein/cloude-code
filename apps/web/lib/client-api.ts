import "client-only";

import type {
  UserInfo,
  Repo,
  ListReposResponse,
  ListBranchesResponse,
  CreateSessionResponse,
  DeleteSessionResponse,
  ArchiveSessionResponse,
  SessionInfoResponse,
  ListSessionsResponse,
  SessionSummary,
  UpdateSessionTitleResponse,
  PullRequestResponse,
  PullRequestStatusResponse,
  EditorOpenResponse,
  EditorCloseResponse,
  GitHubAuthUrlResponse,
  LogoutResponse,
  OpenAIAuthUrlResponse,
  OpenAIStatusResponse,
  OpenAIDisconnectResponse,
  ClaudeAuthUrlResponse,
  ClaudeTokenResponse,
  ClaudeStatusResponse,
  ClaudeDisconnectResponse,
  SessionSettingsInput,
  UploadAttachmentResponse,
} from "@repo/shared";

// Re-export types that other modules import from this file
export type { UserInfo, Repo, SessionSummary, PullRequestResponse, PullRequestStatusResponse };

// WebSocket URL still uses direct API URL (not proxied)
export const WS_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

// All REST calls go through the Next.js API proxy (same-origin, cookie-based auth)
const API_BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new ApiError("Unauthorized", 401);
    }
    const text = await res.text();
    throw new ApiError(
      text || `Request failed: ${res.status}`,
      res.status,
    );
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
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function getCurrentUser(): Promise<UserInfo> {
  return apiFetch("/auth/me");
}

export async function listRepos(): Promise<ListReposResponse> {
  return apiFetch("/repos");
}

export async function listBranches(repoId: number): Promise<ListBranchesResponse> {
  return apiFetch(`/repos/${repoId}/branches`);
}

export async function createSession(
  repoId: number,
  repoFullName: string,
  initialMessage?: string,
  branch?: string,
  settings?: SessionSettingsInput,
  attachmentIds?: string[],
): Promise<CreateSessionResponse> {
  return apiFetch("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repoId,
      repoFullName,
      initialMessage,
      branch,
      settings,
      attachmentIds,
    }),
  });
}

export async function listSessions(repoId?: number): Promise<ListSessionsResponse> {
  const params = repoId ? `?repoId=${repoId}` : "";
  return apiFetch(`/sessions${params}`);
}

export async function getSession(sessionId: string): Promise<SessionInfoResponse> {
  return apiFetch(`/sessions/${sessionId}`);
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

export async function openEditor(sessionId: string): Promise<EditorOpenResponse> {
  return apiFetch(`/sessions/${sessionId}/editor/open`, { method: "POST" });
}

export async function closeEditor(sessionId: string): Promise<EditorCloseResponse> {
  return apiFetch(`/sessions/${sessionId}/editor/close`, { method: "POST" });
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
export async function getGitHubAuthUrl(): Promise<GitHubAuthUrlResponse> {
  return apiFetch("/auth/github");
}

export async function logoutUser(): Promise<LogoutResponse> {
  return apiFetch("/auth/logout", { method: "POST" });
}

// OpenAI OAuth
export async function getOpenAIAuthUrl(): Promise<OpenAIAuthUrlResponse> {
  return apiFetch("/auth/openai");
}

export async function getOpenAIStatus(): Promise<OpenAIStatusResponse> {
  return apiFetch("/auth/openai/status");
}

export async function disconnectOpenAI(): Promise<OpenAIDisconnectResponse> {
  return apiFetch("/auth/openai/disconnect", { method: "POST" });
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
