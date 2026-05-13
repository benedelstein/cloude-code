import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "@/lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!API_URL) {
    return new NextResponse("API URL not set", { status: 500 });
  }
  const { path } = await params;
  const apiPath = path.join("/");
  const url = new URL(req.url);
  const target = `${API_URL}/${apiPath}${url.search}`;

  const token = await getSessionTokenFromRequest(req);

  const headers = new Headers(req.headers);
  // Remove host/cookie — forward only the auth token
  headers.delete("host");
  headers.delete("cookie");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const hasBody = !["GET", "HEAD"].includes(req.method);
  // Buffer the request body before forwarding. Streaming `req.body` directly
  // into fetch is unreliable in Next.js's Node runtime — if the body has been
  // touched upstream, the stream is null/closed and undici throws
  // "expected non-null body source" with `duplex: "half"`.
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const res = await fetch(target, {
    method: req.method,
    headers,
    body,
  });

  const responseHeaders = new Headers(res.headers);
  // Remove hop-by-hop and encoding headers — fetch() already decompressed.
  responseHeaders.delete("transfer-encoding");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  // Buffer the response too, for the same reason — streaming non-2xx bodies
  // through NextResponse has caused 500s in this runtime.
  const responseBody = await res.arrayBuffer();

  return new NextResponse(responseBody, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
