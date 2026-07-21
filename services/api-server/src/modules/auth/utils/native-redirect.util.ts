import { failure, success, type Result } from "@repo/shared";
import type { Env } from "@/shared/types";

export type NativeRedirectError = {
  code: "INVALID_NATIVE_REDIRECT_URI";
  message: string;
};

const PRODUCTION_NATIVE_REDIRECT_URIS = ["cloudecode://auth/callback"];
const DEVELOPMENT_NATIVE_REDIRECT_URIS = ["cloudecode-dev://auth/callback"];
const PRODUCTION_NATIVE_INSTALL_REDIRECT_URIS = ["cloudecode://github/install/complete"];
const DEVELOPMENT_NATIVE_INSTALL_REDIRECT_URIS = ["cloudecode-dev://github/install/complete"];

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

/** Resolve the installation callback paired with an allowlisted OAuth callback. */
export function nativeInstallRedirectUri(
  oauthRedirectUri: string,
  env: Env,
): Result<string, NativeRedirectError> {
  const oauthResult = validateNativeRedirectUri(oauthRedirectUri, env);
  if (!oauthResult.ok) {
    return oauthResult;
  }

  switch (oauthResult.value) {
    case "cloudecode://auth/callback":
      return success("cloudecode://github/install/complete");
    case "cloudecode-dev://auth/callback":
      return success("cloudecode-dev://github/install/complete");
    default:
      return failure({
        code: "INVALID_NATIVE_REDIRECT_URI",
        message: `Native redirect URI has no installation callback: ${oauthResult.value}`,
      });
  }
}

/** Validate a stored native GitHub App installation callback URI. */
export function validateNativeInstallRedirectUri(
  uri: string,
  env: Env,
): Result<string, NativeRedirectError> {
  if (PRODUCTION_NATIVE_INSTALL_REDIRECT_URIS.includes(uri)) {
    return success(uri);
  }
  if (
    env.ENVIRONMENT !== "production"
    && DEVELOPMENT_NATIVE_INSTALL_REDIRECT_URIS.includes(uri)
  ) {
    return success(uri);
  }

  return failure({
    code: "INVALID_NATIVE_REDIRECT_URI",
    message: `Native installation redirect URI is not allowed: ${uri}`,
  });
}
