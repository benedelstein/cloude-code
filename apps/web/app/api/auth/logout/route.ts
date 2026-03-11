import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionTokenFromRequest } from "@/lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function POST(req: NextRequest) {
  if (!API_URL) {
    return new NextResponse("API URL not set", { status: 500 });
  }
  const token = await getSessionTokenFromRequest(req);

  if (token) {
    // Best-effort logout on the API side
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);

  return response;
}
