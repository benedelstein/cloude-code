import { NextRequest, NextResponse } from "next/server";
import {
  type GitHubAuthErrorMessage,
  type GitHubAuthSuccessMessage,
  githubAuthPopupMessageType,
} from "@/types/auth";
import { setSessionCookie } from "@/lib/session";
import { UserInfo } from "@repo/shared";

/**
 * GitHub OAuth callback handler.
 * The API server performs the full token exchange and redirects here with
 * the session token and user info as query params. This route just sets the
 * session cookie and closes the popup via postMessage.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Check for error from the API server
  const error = searchParams.get("error");
  if (error) {
    return new NextResponse(
      postPopupMessage({
        type: githubAuthPopupMessageType.authError,
        error,
      }),
      { headers: { "Content-Type": "text/html" } },
    );
  }

  const token = searchParams.get("token");
  const userJson = searchParams.get("user");
  const hasInstallations = searchParams.get("hasInstallations") === "true";
  const installUrl = searchParams.get("installUrl");

  if (!token || !userJson || !installUrl) {
    return new NextResponse(
      postPopupMessage({
        type: githubAuthPopupMessageType.authError,
        error: "Missing authentication data.",
      }),
      { headers: { "Content-Type": "text/html" } },
    );
  }

  let user: UserInfo;
  try {
    user = UserInfo.parse(JSON.parse(userJson));
  } catch {
    return new NextResponse(
      postPopupMessage({
        type: githubAuthPopupMessageType.authError,
        error: "Invalid user data.",
      }),
      { headers: { "Content-Type": "text/html" } },
    );
  }

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
