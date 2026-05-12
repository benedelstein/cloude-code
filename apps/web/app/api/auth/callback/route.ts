import { NextRequest, NextResponse } from "next/server";
import {
  type GitHubAuthErrorMessage,
  type GitHubAuthSuccessMessage,
  githubAuthPopupMessageType,
} from "@/types/auth";
import { setSessionCookie } from "@/lib/session";
import {
  exchangeGitHubCode,
  getOAuthBounceTarget,
  ServerApiError,
} from "@/lib/server-api";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");

  if (!code || !state) {
    return popupErrorResponse("Missing GitHub authorization code or state.");
  }

  // Peek the originating origin recorded against this state. If GitHub
  // redirected us here but the flow started on a different origin (e.g. a
  // Vercel preview branch), 302 the code+state to that origin's /api/auth/callback
  // so the cookie is set on the originating origin and postMessage to the
  // popup's opener succeeds the same-origin check.
  let recordedOrigin: string;
  try {
    const target = await getOAuthBounceTarget(state);
    recordedOrigin = target.redirectOrigin;
  } catch (error) {
    const message = error instanceof ServerApiError
      ? "GitHub sign-in could not be completed. The session may have expired — please try again."
      : "Failed to resolve sign-in target. Try again.";
    return popupErrorResponse(message);
  }

  if (recordedOrigin !== requestUrl.origin) {
    const target = new URL("/api/auth/callback", recordedOrigin);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    return NextResponse.redirect(target.toString(), 302);
  }

  let tokenResponse;
  try {
    tokenResponse = await exchangeGitHubCode(code, state);
  } catch (error) {
    const message = error instanceof ServerApiError
      ? error.message
      : "GitHub sign-in failed. Try again.";
    return popupErrorResponse(message);
  }

  const { token, user, hasInstallations, installUrl } = tokenResponse;

  const result = new NextResponse(
    postPopupMessage({
      type: githubAuthPopupMessageType.authSuccess,
      user,
      hasInstallations,
      installUrl,
    }),
    {
      headers: { "Content-Type": "text/html" },
    },
  );
  await setSessionCookie(result, token);

  return result;
}

function popupErrorResponse(error: string): NextResponse {
  return new NextResponse(
    postPopupMessage({
      type: githubAuthPopupMessageType.authError,
      error,
    }),
    { headers: { "Content-Type": "text/html" } },
  );
}

function postPopupMessage(
  message: GitHubAuthSuccessMessage | GitHubAuthErrorMessage,
): string {
  const serializedMessage = JSON.stringify(message);

  // Escape characters that could break out of a <script> context.
  // JSON.stringify doesn't escape '<' or '/', so '</script>' in user data
  // would terminate the script tag and allow injection.
  const safeMessage = serializedMessage
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

  return `<!DOCTYPE html>
<html><body><script>
  if (window.opener) {
    window.opener.postMessage(${safeMessage}, window.location.origin);
  }
  window.close();
</script></body></html>`;
}
