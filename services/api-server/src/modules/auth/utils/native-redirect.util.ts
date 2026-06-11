import { failure, success, type Result } from "@repo/shared";
import type { Env } from "@/shared/types";

export type NativeRedirectError = {
  code: "INVALID_NATIVE_REDIRECT_URI";
  message: string;
};

const PRODUCTION_NATIVE_REDIRECT_URIS = ["cloudecode://auth/callback"];
const DEVELOPMENT_NATIVE_REDIRECT_URIS = ["cloudecode-dev://auth/callback"];

/**
 * Validate a native app OAuth redirect URI against a hardcoded allowlist.
 *
 * Native clients (the iOS app) can't receive an https bounce; instead the
 * OAuth callback 302s straight to a custom URL scheme that
 * ASWebAuthenticationSession intercepts. Exact string matching (no URL
 * parsing) keeps the allowlist airtight — there is nothing to normalize or
 * smuggle. The dev-scheme URI is only accepted outside production.
 *
 * Like validateRedirectOrigin, this runs on write (state creation) and on
 * read (at bounce time) for defense-in-depth.
 */
export function validateNativeRedirectUri(
  uri: string,
  env: Env,
): Result<string, NativeRedirectError> {
  if (PRODUCTION_NATIVE_REDIRECT_URIS.includes(uri)) {
    return success(uri);
  }
  if (
    env.ENVIRONMENT !== "production"
    && DEVELOPMENT_NATIVE_REDIRECT_URIS.includes(uri)
  ) {
    return success(uri);
  }

  return failure({
    code: "INVALID_NATIVE_REDIRECT_URI",
    message: `Native redirect URI is not allowed: ${uri}`,
  });
}

/** Quick shape check so the callback knows which validator owns a stored value. */
export function looksLikeNativeRedirectUri(value: string): boolean {
  return (
    PRODUCTION_NATIVE_REDIRECT_URIS.includes(value)
    || DEVELOPMENT_NATIVE_REDIRECT_URIS.includes(value)
  );
}
