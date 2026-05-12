import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * OAuth bouncer for Vercel preview branches.
 *
 * The GitHub App's callback URL is pinned to this prod-domain endpoint. We
 * look up the originating browser origin (recorded against the state nonce in
 * `GET /auth/github`) by asking the api-server, then 302 the OAuth code+state
 * to that origin's existing `/api/auth/callback` handler. That handler runs
 * on the originating origin, so it can set the session cookie and post a
 * same-origin message back to the popup's opener.
 *
 * Security: the redirect target is read from server-side state, not from any
 * URL parameter the caller controls. The api-server re-validates the stored
 * origin against the preview allowlist before returning it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return errorPage("Missing GitHub authorization code or state.", 400);
  }

  if (!API_URL) {
    return errorPage("Server is misconfigured (NEXT_PUBLIC_API_URL).", 500);
  }

  let redirectOrigin: string;
  try {
    const response = await fetch(
      `${API_URL}/auth/bounce-target?state=${encodeURIComponent(state)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return errorPage(
        "GitHub sign-in could not be completed. The session may have expired — please try again.",
        400,
      );
    }
    const data = (await response.json()) as { redirectOrigin?: unknown };
    if (typeof data.redirectOrigin !== "string" || !data.redirectOrigin) {
      return errorPage("Invalid bounce target.", 500);
    }
    redirectOrigin = data.redirectOrigin;
  } catch {
    return errorPage("Failed to resolve sign-in target. Try again.", 502);
  }

  const target = new URL("/api/auth/callback", redirectOrigin);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);

  return NextResponse.redirect(target.toString(), 302);
}

function errorPage(message: string, status: number): NextResponse {
  // The popup is on the prod origin here, but the opener is on the originating
  // (e.g. preview) origin. Cross-origin postMessage from this page would be
  // rejected by the opener's same-origin check, so we just render the error
  // and let the user close the popup. The opener's popup-closed poller will
  // then re-check auth state.
  const safeMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return new NextResponse(
    `<!DOCTYPE html>
<html><head><title>Sign in failed</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; max-width: 32rem;">
  <h1 style="font-size: 1.25rem;">Sign in failed</h1>
  <p>${safeMessage}</p>
  <p><button onclick="window.close()">Close</button></p>
</body></html>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
