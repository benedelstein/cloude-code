import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function GET(request: NextRequest) {
  if (!API_URL) {
    return new NextResponse("API URL not set", { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return new NextResponse(popupHtml(false, "Missing GitHub authorization code or state."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // TODO: USE API.TS 
  const response = await fetch(`${API_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });

  if (!response.ok) {
    return new NextResponse(
      popupHtml(false, await getAuthErrorMessage(response)),
      {
        headers: { "Content-Type": "text/html" },
      },
    );
  }

  const { token, user, hasInstallations, installUrl } = await response.json();

  const result = new NextResponse(
    popupHtml(true, undefined, user, hasInstallations, installUrl),
    {
      headers: { "Content-Type": "text/html" },
    },
  );
  await setSessionCookie(result, token);

  return result;
}

function popupHtml(
  success: boolean,
  error?: string,
  user?: Record<string, unknown>,
  hasInstallations?: boolean,
  installUrl?: string,
): string {
  const message = success
    ? JSON.stringify({ type: "auth:success", user, hasInstallations, installUrl })
    : JSON.stringify({ type: "auth:error", error });

  // Escape characters that could break out of a <script> context.
  // JSON.stringify doesn't escape '<' or '/', so '</script>' in user data
  // would terminate the script tag and allow injection.
  const safeMessage = message
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

async function getAuthErrorMessage(response: Response): Promise<string> {
  const defaultMessage = "GitHub sign-in failed. Try again.";
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const body = await response.json();
      if (body && typeof body.error === "string" && body.error.length > 0) {
        return body.error;
      }
    } catch {
      return defaultMessage;
    }
  }

  try {
    const text = await response.text();
    return text || defaultMessage;
  } catch {
    return defaultMessage;
  }
}
