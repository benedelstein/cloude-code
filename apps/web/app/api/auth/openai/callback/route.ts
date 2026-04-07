import { NextResponse } from "next/server";

export async function GET() {
  return new NextResponse(
    `<!DOCTYPE html>
<html><body><script>
  if (window.opener) {
    window.opener.postMessage({ type: "openai:error", error: "Browser callback auth is disabled. Use device code auth." }, window.location.origin);
  }
  window.close();
</script></body></html>`,
    {
      status: 410,
      headers: { "Content-Type": "text/html" },
    },
  );
}
