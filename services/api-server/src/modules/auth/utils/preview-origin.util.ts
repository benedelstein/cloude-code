import { failure, success, type Result } from "@repo/shared";
import type { Env } from "@/shared/types";

export type PreviewOriginError = {
  code: "INVALID_ORIGIN";
  message: string;
};

/**
 * Validate that an origin is allowed to receive an OAuth bounce redirect.
 *
 * Accepts the configured web origin (`env.WEB_ORIGIN`) unconditionally.
 * In non-production environments, local loopback origins are also accepted for
 * local OAuth testing. Any other origin must:
 *   1. Parse as a valid `https:` URL with no path, query, or fragment.
 *   2. Match `env.PREVIEW_ORIGIN_ALLOWLIST_REGEX` exactly.
 *
 * The regex is expected to pin both the project name and the Vercel team slug
 * as string literals so that other teams cannot produce a matching URL.
 *
 * Runs on write (when state is created) and on read (at bounce time) for
 * defense-in-depth — if the regex env var changes, previously stored origins
 * are re-checked before being used as a redirect target.
 */
export function validateRedirectOrigin(
  origin: string,
  env: Env,
): Result<string, PreviewOriginError> {
  if (!origin) {
    return failure({
      code: "INVALID_ORIGIN",
      message: "Origin is required.",
    });
  }

  if (origin === env.WEB_ORIGIN) {
    return success(origin);
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return failure({
      code: "INVALID_ORIGIN",
      message: `Origin is not a valid URL: ${origin}`,
    });
  }

  // Origin-only: scheme + host (+ optional port). Path/query/fragment are
  // rejected so callers can't smuggle a redirect path through the regex.
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return failure({
      code: "INVALID_ORIGIN",
      message: `Origin must not include a path: ${origin}`,
    });
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    return failure({
      code: "INVALID_ORIGIN",
      message: `Origin must not include query or fragment: ${origin}`,
    });
  }

  // Compare against `parsed.origin` to normalize trailing slashes etc.
  const normalized = parsed.origin;

  if (isLocalDevelopmentOrigin(parsed, env)) {
    return success(normalized);
  }

  if (parsed.protocol !== "https:") {
    return failure({
      code: "INVALID_ORIGIN",
      message: `Origin must use https: ${origin}`,
    });
  }

  const allowlistPattern = env.PREVIEW_ORIGIN_ALLOWLIST_REGEX;
  if (!allowlistPattern) {
    return failure({
      code: "INVALID_ORIGIN",
      message: "Preview origin allowlist is not configured.",
    });
  }

  let allowlist: RegExp;
  try {
    allowlist = new RegExp(allowlistPattern);
  } catch {
    return failure({
      code: "INVALID_ORIGIN",
      message: "Preview origin allowlist regex is invalid.",
    });
  }

  if (!allowlist.test(normalized)) {
    return failure({
      code: "INVALID_ORIGIN",
      message: `Origin is not allowed: ${normalized}`,
    });
  }

  return success(normalized);
}

function isLocalDevelopmentOrigin(parsed: URL, env: Env): boolean {
  if (env.ENVIRONMENT === "production") {
    return false;
  }

  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:")
    && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  );
}
