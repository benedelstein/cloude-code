import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * Compatibility bridge for local GitHub App callback URLs that point at the
 * web dev server instead of the API worker. The API owns OAuth state and
 * decides whether to bounce to a web finalize URL or a native deep link.
 */
export async function GET(request: NextRequest) {
  if (!API_URL) {
    return new NextResponse("API URL not set", { status: 500 });
  }

  const url = new URL(request.url);
  const apiCallback = new URL("/auth/callback", API_URL);
  apiCallback.search = url.search;

  const response = await fetch(apiCallback, {
    method: "GET",
    cache: "no-store",
    redirect: "manual",
  });

  const location = response.headers.get("location");
  if (location && response.status >= 300 && response.status < 400) {
    return new NextResponse(null, {
      status: response.status,
      headers: { Location: location },
    });
  }

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "text/plain",
    },
  });
}
