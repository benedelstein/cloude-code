import { NextRequest, NextResponse } from "next/server";
import {
  type GitHubAuthErrorMessage,
  type GitHubAuthSuccessMessage,
  githubAuthPopupMessageType,
} from "@/types/auth";
import { setSessionCookie } from "@/lib/session";
import { exchangeGitHubCode, ServerApiError } from "@/lib/server-api";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return new NextResponse(postPopupMessage({
      type: githubAuthPopupMessageType.authError,
      error: "Missing GitHub authorization code or state.",
    }), {
      headers: { "Content-Type": "text/html" },
    });
  }

  let tokenResponse;
  try {
    tokenResponse = await exchangeGitHubCode(code, state);
  } catch (error) {
    const message = error instanceof ServerApiError
      ? error.message
      : "GitHub sign-in failed. Try again.";
    return new NextResponse(
      postPopupMessage({
        type: githubAuthPopupMessageType.authError,
        error: message,
      }),
      { headers: { "Content-Type": "text/html" } },
    );
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
