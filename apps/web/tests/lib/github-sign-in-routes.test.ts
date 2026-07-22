import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

process.env.SESSION_COOKIE_SECRET = Buffer.from(
  "0123456789abcdef0123456789abcdef",
).toString("base64");

const startWebGitHubSignIn = vi.fn();
const completeWebGitHubSignIn = vi.fn();
const getAuthenticatedUser = vi.fn();

class ServerApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

vi.mock("@/lib/server-api", () => ({
  startWebGitHubSignIn: (...args: unknown[]) => startWebGitHubSignIn(...args),
  completeWebGitHubSignIn: (...args: unknown[]) => completeWebGitHubSignIn(...args),
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  ServerApiError,
}));

const { GET: startRoute } = await import("@/app/api/auth/github/start/route");
const { GET: completeRoute } = await import("@/app/api/auth/github/complete/route");
const { encryptCookieValue, setSessionCookie } = await import("@/lib/session");

const ORIGIN = "https://web.test";
const ATTEMPT_COOKIE = "github_sign_in_attempt";
const SESSION_COOKIE = "session_token";

async function attemptCookieValue(attemptId: string, claimToken: string) {
  return encryptCookieValue(JSON.stringify({ attemptId, claimToken }));
}

async function sessionCookieValue(token: string) {
  const carrier = NextResponse.next();
  await setSessionCookie(carrier, token);
  return carrier.cookies.get(SESSION_COOKIE)?.value ?? "";
}

function startRequest(returnTo?: string): NextRequest {
  const url = new URL("/api/auth/github/start", ORIGIN);
  if (returnTo !== undefined) {
    url.searchParams.set("returnTo", returnTo);
  }
  return new NextRequest(url);
}

function completeRequest(
  query: { attemptId?: string; error?: string },
  cookies: { attempt?: string; session?: string } = {},
): NextRequest {
  const url = new URL("/api/auth/github/complete", ORIGIN);
  if (query.attemptId) {
    url.searchParams.set("attemptId", query.attemptId);
  }
  if (query.error) {
    url.searchParams.set("error", query.error);
  }
  const request = new NextRequest(url);
  if (cookies.attempt) {
    request.cookies.set(ATTEMPT_COOKIE, cookies.attempt);
  }
  if (cookies.session) {
    request.cookies.set(SESSION_COOKIE, cookies.session);
  }
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  startWebGitHubSignIn.mockResolvedValue({
    authorizeUrl: "https://github.test/authorize?state=state-1",
    attemptId: "attempt-1",
    claimToken: "claim-1",
  });
});

describe("GET /api/auth/github/start", () => {
  it("redirects to GitHub and stores the claim in a narrowly scoped cookie", async () => {
    const response = await startRoute(startRequest("/discord/link?token=abc"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.test/authorize?state=state-1",
    );
    expect(startWebGitHubSignIn).toHaveBeenCalledWith(
      ORIGIN,
      "/discord/link?token=abc",
    );

    const cookie = response.cookies.get(ATTEMPT_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(600);
    expect(cookie?.path).toBe("/api/auth/github");
    // The raw claim token must not be readable from the cookie value.
    expect(cookie?.value).not.toContain("claim-1");
  });

  it("replaces a cross-origin return target with the default app route", async () => {
    for (const returnTo of ["https://evil.test/", "//evil.test", "/\\evil.test"]) {
      await startRoute(startRequest(returnTo));
      expect(startWebGitHubSignIn).toHaveBeenLastCalledWith(ORIGIN, "/dashboard");
    }
  });

  it("returns to the signed-out retry surface when the API rejects the start", async () => {
    startWebGitHubSignIn.mockRejectedValue(new ServerApiError("nope", 400));

    const response = await startRoute(startRequest("/dashboard"));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/?signInError=failed`);
  });
});

describe("GET /api/auth/github/complete", () => {
  it("sets the session cookie and redirects to the returned app URL", async () => {
    completeWebGitHubSignIn.mockResolvedValue({
      token: "session-token",
      user: { id: "user-1", login: "octocat", name: null, avatarUrl: null },
      redirectUrl: `${ORIGIN}/discord/link?token=abc`,
    });

    const response = await completeRoute(completeRequest(
      { attemptId: "attempt-1" },
      { attempt: await attemptCookieValue("attempt-1", "claim-1") },
    ));

    expect(completeWebGitHubSignIn).toHaveBeenCalledWith("attempt-1", "claim-1");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/discord/link?token=abc`);
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
    expect(response.cookies.get(ATTEMPT_COOKIE)?.maxAge).toBe(0);
  });

  it("sets the session cookie before sending the tab to GitHub installation", async () => {
    completeWebGitHubSignIn.mockResolvedValue({
      token: "session-token",
      user: { id: "user-1", login: "octocat", name: null, avatarUrl: null },
      redirectUrl: "https://github.test/install?state=state-2",
    });

    const response = await completeRoute(completeRequest(
      { attemptId: "attempt-1" },
      { attempt: await attemptCookieValue("attempt-1", "claim-1") },
    ));

    expect(response.headers.get("location")).toBe(
      "https://github.test/install?state=state-2",
    );
    // Abandoning installation from here still leaves the user authenticated.
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("claims a matching attempt even when a session cookie already exists", async () => {
    completeWebGitHubSignIn.mockResolvedValue({
      token: "new-session-token",
      user: { id: "user-1", login: "octocat", name: null, avatarUrl: null },
      redirectUrl: `${ORIGIN}/dashboard`,
    });
    getAuthenticatedUser.mockResolvedValue({ id: "user-1" });

    const response = await completeRoute(completeRequest(
      { attemptId: "attempt-1" },
      {
        attempt: await attemptCookieValue("attempt-1", "claim-1"),
        session: await sessionCookieValue("old-session-token"),
      },
    ));

    expect(completeWebGitHubSignIn).toHaveBeenCalledOnce();
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("clears the matching cookie and reports denial on OAUTH_DENIED", async () => {
    const response = await completeRoute(completeRequest(
      { attemptId: "attempt-1", error: "OAUTH_DENIED" },
      { attempt: await attemptCookieValue("attempt-1", "claim-1") },
    ));

    expect(completeWebGitHubSignIn).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?signInError=denied`);
    expect(response.cookies.get(ATTEMPT_COOKIE)?.maxAge).toBe(0);
  });

  it("preserves a newer tab's attempt cookie when an older callback arrives", async () => {
    const response = await completeRoute(completeRequest(
      { attemptId: "older-attempt" },
      { attempt: await attemptCookieValue("newer-attempt", "claim-2") },
    ));

    expect(completeWebGitHubSignIn).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/?signInError=failed`);
    expect(response.cookies.get(ATTEMPT_COOKIE)).toBeUndefined();
  });

  it("sends a revisited completion URL with a valid session to the app", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "user-1" });

    const response = await completeRoute(completeRequest(
      { attemptId: "attempt-1" },
      { session: await sessionCookieValue("session-token") },
    ));

    expect(completeWebGitHubSignIn).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`);
  });

  it("shows the retry surface with neither a matching claim nor a valid session", async () => {
    getAuthenticatedUser.mockRejectedValue(new ServerApiError("nope", 401));

    const response = await completeRoute(completeRequest(
      { attemptId: "attempt-1" },
      { session: await sessionCookieValue("stale-session-token") },
    ));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/?signInError=failed`);
  });

  it("clears the cookie and reports expiry when the attempt can no longer be claimed", async () => {
    completeWebGitHubSignIn.mockRejectedValue(new ServerApiError("expired", 400));

    const response = await completeRoute(completeRequest(
      { attemptId: "attempt-1" },
      { attempt: await attemptCookieValue("attempt-1", "claim-1") },
    ));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/?signInError=expired`);
    expect(response.cookies.get(ATTEMPT_COOKIE)?.maxAge).toBe(0);
  });
});
