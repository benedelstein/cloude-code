import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "@/lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const HOP_BY_HOP_REQUEST_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function stripForwardedRequestHeaders(headers: Headers) {
  const connectionHeader = headers.get("connection");
  if (connectionHeader) {
    for (const headerName of connectionHeader.split(",")) {
      const normalizedHeaderName = headerName.trim().toLowerCase();
      if (normalizedHeaderName) {
        headers.delete(normalizedHeaderName);
      }
    }
  }

  for (const headerName of HOP_BY_HOP_REQUEST_HEADERS) {
    headers.delete(headerName);
  }
  headers.delete("content-length");
}

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
  stripForwardedRequestHeaders(headers);
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
  // through NextResponse has caused 500s in this runtime. Status codes that
  // forbid a body (204, 304) must be returned with null body.
  const bodylessStatus = res.status === 204 || res.status === 304;
  const responseBody = bodylessStatus ? null : await res.arrayBuffer();

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
