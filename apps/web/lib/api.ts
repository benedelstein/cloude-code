// WebSocket URL still uses direct API URL (not proxied)
export const WS_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

// All REST calls go through the Next.js API proxy (same-origin, cookie-based auth)
const API_BASE = "/api";

export interface SessionResponse {
  sessionId: string;
}

export interface UserInfo {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface Repo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
}

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

  return res.json();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function getCurrentUser(): Promise<UserInfo> {
  return apiFetch("/auth/me");
}

export async function listRepos(): Promise<{ repos: Repo[]; installUrl: string }> {
  return apiFetch("/repos");
}

export async function createSession(repoId: string): Promise<SessionResponse> {
  return apiFetch("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId }),
  });
}

export async function getSession(sessionId: string): Promise<SessionResponse> {
  return apiFetch(`/sessions/${sessionId}`);
}
