export const SIGN_IN_START_PATH = "/api/auth/github/start";
export const SIGN_IN_COMPLETE_PATH = "/api/auth/github/complete";
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";
export const SIGN_IN_ERROR_PARAM = "signInError";

export type SignInErrorCode = "denied" | "failed" | "expired";

const SIGN_IN_ERROR_MESSAGES: Record<SignInErrorCode, string> = {
  denied: "GitHub sign-in was canceled.",
  failed: "GitHub sign-in failed. Try again.",
  expired: "GitHub sign-in took too long. Try again.",
};

export function signInErrorMessage(code: string | null): string | null {
  if (!code) {
    return null;
  }
  return SIGN_IN_ERROR_MESSAGES[code as SignInErrorCode]
    ?? SIGN_IN_ERROR_MESSAGES.failed;
}

/**
 * Validate a same-origin application path to come back to after sign-in.
 *
 * Same-tab sign-in leaves the current page, so the caller's route has to be
 * carried through the flow. Anything that is not a plain relative path is
 * replaced by the default signed-in route rather than normalized.
 */
export function safeReturnToPath(value: string | null | undefined): string {
  if (
    !value
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
  ) {
    return DEFAULT_SIGNED_IN_PATH;
  }

  try {
    const parsed = new URL(value, "https://return-to.invalid");
    if (parsed.origin !== "https://return-to.invalid") {
      return DEFAULT_SIGNED_IN_PATH;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_SIGNED_IN_PATH;
  }
}

/** The same-tab navigation target that begins GitHub sign-in. */
export function signInStartUrl(returnTo: string): string {
  return `${SIGN_IN_START_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}
