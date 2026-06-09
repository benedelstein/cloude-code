import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { getSessionTokenFromRequest } from "@/lib/session";

// The integration link-claim pages must stay reachable while logged out —
// they render their own sign-in button and claim the link after auth.
const publicRoutes = ["/", "/github/install/complete", "/discord/link", "/integrations/link"];

// Optimistic auth check — reads cookie only, no DB call.
// https://nextjs.org/docs/app/guides/authentication#optimistic-checks-with-proxy-optional
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = publicRoutes.some((route) =>
    route === "/" ? pathname === "/" : pathname.startsWith(route),
  );

  if (isPublic) {
    return NextResponse.next();
  }

  const sessionToken = await getSessionTokenFromRequest(request);
  if (!sessionToken) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
