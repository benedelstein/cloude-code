import { NextRequest, NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "@/lib/session";

const publicRoutes = ["/login"];

// Optimistic auth check — reads cookie only, no DB call.
// https://nextjs.org/docs/app/guides/authentication#optimistic-checks-with-proxy-optional
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = publicRoutes.some((route) =>
    pathname.startsWith(route),
  );

  if (isPublic) {
    return NextResponse.next();
  }

  const sessionToken = await getSessionTokenFromRequest(request);
  if (!sessionToken) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
