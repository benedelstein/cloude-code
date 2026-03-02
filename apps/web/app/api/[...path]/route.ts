import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const apiPath = path.join("/");
  const url = new URL(req.url);
  const target = `${API_URL}/${apiPath}${url.search}`;

  const token = req.cookies.get("session_token")?.value;

  const headers = new Headers(req.headers);
  // Remove host/cookie — forward only the auth token
  headers.delete("host");
  headers.delete("cookie");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const res = await fetch(target, {
    method: req.method,
    headers,
    ...(hasBody && { body: req.body, duplex: "half" }),
  });

  const responseHeaders = new Headers(res.headers);
  // Remove hop-by-hop and encoding headers — fetch() already decompresses the body
  responseHeaders.delete("transfer-encoding");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new NextResponse(res.body, {
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
