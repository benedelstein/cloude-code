import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "@/lib/session";
import { exchangeOpenAICode } from "@/lib/server-api";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return new NextResponse(postPopupMessage(false), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const sessionToken = await getSessionTokenFromRequest(request);
  if (!sessionToken) {
    return new NextResponse(postPopupMessage(false, "Not logged in"), {
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    await exchangeOpenAICode(sessionToken, code, state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new NextResponse(postPopupMessage(false, message), {
      headers: { "Content-Type": "text/html" },
    });
  }

  return new NextResponse(postPopupMessage(true), {
    headers: { "Content-Type": "text/html" },
  });
}

function postPopupMessage(success: boolean, error?: string): string {
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
