import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { setSignInAttemptCookie } from "@/lib/sign-in-attempt";
import {
  safeReturnToPath,
  SIGN_IN_ERROR_PARAM,
} from "@/lib/sign-in-navigation";
import { startWebGitHubSignIn } from "@/lib/server-api";

/**
 * Begins GitHub sign-in as an ordinary top-level navigation.
 *
 * This is a state-changing GET on purpose: sign-in has to start from a link or
 * button navigation, not a fetch. A cross-site page can trigger the navigation
 * but cannot read or set this origin's HttpOnly attempt cookie and cannot
 * supply a cross-origin `returnTo`, so it cannot bind the resulting session to
 * an attacker-chosen attempt.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const returnTo = safeReturnToPath(request.nextUrl.searchParams.get("returnTo"));

  let attempt;
  try {
    attempt = await startWebGitHubSignIn(origin, returnTo);
  } catch (error) {
    console.error("Failed to start GitHub sign-in", error);
    return NextResponse.redirect(
      new URL(`/?${SIGN_IN_ERROR_PARAM}=failed`, origin),
    );
  }

  const response = NextResponse.redirect(attempt.authorizeUrl);
  await setSignInAttemptCookie(response, {
    attemptId: attempt.attemptId,
    claimToken: attempt.claimToken,
  });

  return response;
}
