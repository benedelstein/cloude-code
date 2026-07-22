import type { NextRequest, NextResponse } from "next/server";
import { decryptCookieValue, encryptCookieValue } from "@/lib/session";

const ATTEMPT_COOKIE_NAME = "github_sign_in_attempt";
/** Matches the API's 10-minute web sign-in attempt lifetime exactly. */
export const ATTEMPT_COOKIE_MAX_AGE_SECONDS = 600;
const ATTEMPT_COOKIE_PATH = "/api/auth/github";

export interface SignInAttemptClaim {
  attemptId: string;
  claimToken: string;
}

/**
 * The raw claim token authorizes issuing this browser's web session, so it
 * lives only in an HttpOnly cookie on the origin that started sign-in — never
 * in a redirect URL, page, or client-readable storage.
 */
export async function setSignInAttemptCookie(
  response: NextResponse,
  claim: SignInAttemptClaim,
): Promise<void> {
  response.cookies.set(
    ATTEMPT_COOKIE_NAME,
    await encryptCookieValue(JSON.stringify(claim)),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: ATTEMPT_COOKIE_MAX_AGE_SECONDS,
      path: ATTEMPT_COOKIE_PATH,
    },
  );
}

export async function readSignInAttemptCookie(
  request: NextRequest,
): Promise<SignInAttemptClaim | null> {
  const decrypted = await decryptCookieValue(
    request.cookies.get(ATTEMPT_COOKIE_NAME)?.value,
  );
  if (!decrypted) {
    return null;
  }

  try {
    const parsed = JSON.parse(decrypted) as Partial<SignInAttemptClaim>;
    if (
      typeof parsed.attemptId !== "string"
      || typeof parsed.claimToken !== "string"
    ) {
      return null;
    }
    return { attemptId: parsed.attemptId, claimToken: parsed.claimToken };
  } catch {
    return null;
  }
}

export function clearSignInAttemptCookie(response: NextResponse): void {
  response.cookies.set(ATTEMPT_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: ATTEMPT_COOKIE_PATH,
  });
}
