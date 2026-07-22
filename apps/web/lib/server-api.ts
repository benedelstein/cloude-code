import "server-only";

import type {
  GitHubSignInStartResponse,
  LogoutResponse,
  SessionInfoResponse,
  GitHubReauthTokenResponse,
  UserInfo,
  UserRepoEnvironmentResponse,
  WebGitHubSignInCompleteResponse,
} from "@repo/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

class ServerApiError extends Error {
  public status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ServerApiError";
    this.status = status;
  }
}

/**
 * Server-side fetch helper that calls the API server directly with a bearer
 * token. Unlike client-api.ts (which goes through the Next.js /api proxy),
 * these methods run in route handlers and server components where there is no
 * browser cookie jar.
 */
async function serverApiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  if (!API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }

  const { token, ...fetchInit } = init ?? {};
  const headers = new Headers(fetchInit.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...fetchInit,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let message: string;
    if (contentType.includes("application/json")) {
      const body = await response.json() as { error?: string; details?: string };
      message = body.error ?? body.details ?? `Request failed: ${response.status}`;
    } else {
      const text = await response.text();
      message = text || `Request failed: ${response.status}`;
    }
    throw new ServerApiError(
      message,
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Auth

export async function getAuthenticatedUser(token: string): Promise<UserInfo> {
  return serverApiFetch("/auth/me", { token });
}

export async function getSession(
  sessionId: string,
  token: string,
): Promise<SessionInfoResponse> {
  return serverApiFetch(`/sessions/${sessionId}`, { token });
}

export async function startWebGitHubSignIn(
  origin: string,
  returnTo: string,
): Promise<GitHubSignInStartResponse> {
  return serverApiFetch("/auth/github/web/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, returnTo }),
  });
}

export async function completeWebGitHubSignIn(
  attemptId: string,
  claimToken: string,
  completionCode: string,
): Promise<WebGitHubSignInCompleteResponse> {
  return serverApiFetch("/auth/github/web/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attemptId, claimToken, completionCode }),
  });
}

export async function exchangeGitHubReauthCode(
  code: string,
  state: string,
  token: string,
): Promise<GitHubReauthTokenResponse> {
  return serverApiFetch("/auth/github/reauth/token", {
    token,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
}

export async function serverLogout(token: string): Promise<LogoutResponse> {
  return serverApiFetch("/auth/logout", {
    token,
    method: "POST",
  });
}

export async function getServerUserRepoEnvironment(
  environmentId: string,
  token: string,
): Promise<UserRepoEnvironmentResponse> {
  return serverApiFetch(`/environments/${environmentId}`, { token });
}

export { ServerApiError };
