import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionTokenFromRequest } from "@/lib/session";
import { serverLogout } from "@/lib/server-api";

export async function POST(req: NextRequest) {
  const token = await getSessionTokenFromRequest(req);

  if (token) {
    await serverLogout(token).catch(() => {});
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);

  return response;
}
