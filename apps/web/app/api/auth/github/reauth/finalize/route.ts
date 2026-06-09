import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  type GitHubReauthErrorMessage,
  type GitHubReauthSuccessMessage,
  githubAuthPopupMessageType,
} from "@/types/auth";
import { getSessionTokenFromRequest } from "@/lib/session";
import { exchangeGitHubReauthCode, ServerApiError } from "@/lib/server-api";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const token = await getSessionTokenFromRequest(request);

  if (!code || !state) {
    return popupErrorResponse("Missing GitHub authorization code or state.");
  }

  if (!token) {
    return popupErrorResponse("Sign in before reconnecting GitHub.");
  }

  let tokenResponse;
  try {
    tokenResponse = await exchangeGitHubReauthCode(code, state, token);
  } catch (error) {
    const message = error instanceof ServerApiError
      ? error.message
      : "GitHub reconnect failed. Try again.";
    return popupErrorResponse(message);
  }

  return new NextResponse(
    postPopupMessage({
      type: githubAuthPopupMessageType.githubReauthSuccess,
      installUrl: tokenResponse.installUrl,
    }),
    { headers: { "Content-Type": "text/html" } },
  );
}

function popupErrorResponse(error: string): NextResponse {
  return new NextResponse(
    postPopupMessage({
      type: githubAuthPopupMessageType.githubReauthError,
      error,
    }),
    { headers: { "Content-Type": "text/html" } },
  );
}

function postPopupMessage(
  message: GitHubReauthSuccessMessage | GitHubReauthErrorMessage,
): string {
  const serializedMessage = JSON.stringify(message);
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
