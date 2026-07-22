import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  clearSignInAttemptCookie,
  readSignInAttemptCookie,
} from "@/lib/sign-in-attempt";
import {
  DEFAULT_SIGNED_IN_PATH,
  SIGN_IN_ERROR_PARAM,
  type SignInErrorCode,
} from "@/lib/sign-in-navigation";
import { getSessionTokenFromRequest, setSessionCookie } from "@/lib/session";
import {
  completeWebGitHubSignIn,
  getAuthenticatedUser,
  ServerApiError,
} from "@/lib/server-api";

/**
 * Claims a completed GitHub sign-in attempt and establishes the web session.
 *
 * The API redirects here with only the non-secret attempt ID; the raw claim
 * token never leaves the HttpOnly cookie this origin set when sign-in started.
 * The session cookie is set *before* any GitHub App installation navigation,
 * so abandoning repository setup cannot discard the completed login.
 *
 * Precedence is deliberate:
 *   1. A claim cookie matching the query attempt is processed, even when a
 *      valid session already exists — that session is simply replaced.
 *   2. Otherwise a valid existing session means this is a revisited completion
 *      URL, so the browser goes to the signed-in app.
 *   3. Otherwise the browser returns to the retryable signed-out surface.
 *
 * A non-matching attempt cookie belongs to a newer tab's flow and is preserved.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const attemptId = request.nextUrl.searchParams.get("attemptId");
  const oauthError = request.nextUrl.searchParams.get("error");
  const claim = await readSignInAttemptCookie(request);

  if (!claim || !attemptId || claim.attemptId !== attemptId) {
    const sessionToken = await getSessionTokenFromRequest(request);
    if (sessionToken && await isValidSession(sessionToken)) {
      return NextResponse.redirect(new URL(DEFAULT_SIGNED_IN_PATH, origin));
    }
    return signedOutRedirect(origin, "failed", { clearAttempt: false });
  }

  if (oauthError) {
    return signedOutRedirect(
      origin,
      oauthError === "OAUTH_DENIED" ? "denied" : "failed",
      { clearAttempt: true },
    );
  }

  let completion;
  try {
    completion = await completeWebGitHubSignIn(claim.attemptId, claim.claimToken);
  } catch (error) {
    console.error("Failed to complete GitHub sign-in", error);
    const expired = error instanceof ServerApiError && error.status === 400;
    return signedOutRedirect(origin, expired ? "expired" : "failed", {
      clearAttempt: true,
    });
  }

  const response = NextResponse.redirect(
    new URL(completion.redirectUrl, origin),
  );
  await setSessionCookie(response, completion.token);
  clearSignInAttemptCookie(response);

  return response;
}

async function isValidSession(sessionToken: string): Promise<boolean> {
  try {
    await getAuthenticatedUser(sessionToken);
    return true;
  } catch {
    return false;
  }
}

function signedOutRedirect(
  origin: string,
  code: SignInErrorCode,
  options: { clearAttempt: boolean },
): NextResponse {
  const response = NextResponse.redirect(
    new URL(`/?${SIGN_IN_ERROR_PARAM}=${code}`, origin),
  );
  if (options.clearAttempt) {
    clearSignInAttemptCookie(response);
  }
  return response;
}
