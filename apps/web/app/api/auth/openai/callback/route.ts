import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "@/lib/session";

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

  // Read session token from cookie (user must be logged in via GitHub first)
  const sessionToken = await getSessionTokenFromRequest(request);
  if (!sessionToken) {
    return new NextResponse(popupHtml(false, "Not logged in"), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // Exchange code for OpenAI tokens via the API server
  const response = await fetch(`${API_URL}/auth/openai/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ code, state }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new NextResponse(popupHtml(false, errorText), {
      headers: { "Content-Type": "text/html" },
    });
  }

  return new NextResponse(popupHtml(true), {
    headers: { "Content-Type": "text/html" },
  });
}

function popupHtml(success: boolean, error?: string): string {
  const message = success
    ? JSON.stringify({ type: "openai:success" })
    : JSON.stringify({ type: "openai:error", error: error ?? "Unknown error" });

  // Escape characters that could break out of a <script> context.
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
