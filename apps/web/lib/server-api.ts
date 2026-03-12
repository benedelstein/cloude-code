import "server-only";

import type { UserInfo, TokenResponse, LogoutResponse } from "@repo/shared";

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
    const text = await response.text();
    throw new ServerApiError(
      text || `Request failed: ${response.status}`,
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

export async function exchangeGitHubCode(
  code: string,
  state: string,
): Promise<TokenResponse> {
  return serverApiFetch("/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
}

export async function exchangeOpenAICode(
  token: string,
  code: string,
  state: string,
): Promise<void> {
  return serverApiFetch("/auth/openai/token", {
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

export { ServerApiError };
