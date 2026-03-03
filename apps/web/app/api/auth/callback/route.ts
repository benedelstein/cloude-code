import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function GET(request: NextRequest) {
  if (!API_URL) {
    return new NextResponse("API URL not set", { status: 500 });
  }
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return new NextResponse(popupHtml(false), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const response = await fetch(`${API_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });

  if (!response.ok) {
    return new NextResponse(popupHtml(false), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const { token, user, hasInstallations, installUrl } = await response.json();

  const isProduction = process.env.NODE_ENV === "production";
  const result = new NextResponse(popupHtml(true, user, hasInstallations, installUrl), {
    headers: { "Content-Type": "text/html" },
  });
  result.cookies.set("session_token", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  });

  return result;
}

function popupHtml(
  success: boolean,
  user?: Record<string, unknown>,
  hasInstallations?: boolean,
  installUrl?: string,
): string {
  const message = success
    ? JSON.stringify({ type: "auth:success", user, hasInstallations, installUrl })
    : JSON.stringify({ type: "auth:error" });

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
