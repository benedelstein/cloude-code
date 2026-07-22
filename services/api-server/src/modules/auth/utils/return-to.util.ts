import { failure, success, type Result } from "@repo/shared";

export type ReturnToError = {
  code: "INVALID_RETURN_TO";
  message: string;
};

const RETURN_TO_BASE = "https://return-to.invalid";

/**
 * Validate a same-origin application path to return to after sign-in.
 *
 * Same-tab sign-in has to restore the page the user started from (for example
 * `/discord/link`), which the old popup flow got for free by leaving the
 * caller in place. Only a relative path is accepted: absolute URLs,
 * protocol-relative `//host` targets, and backslash variants are rejected
 * rather than normalized, so a caller cannot smuggle a cross-origin redirect
 * through this value.
 */
export function validateReturnToPath(value: string): Result<string, ReturnToError> {
  const invalid = failure<ReturnToError>({
    code: "INVALID_RETURN_TO",
    message: `Return path is not allowed: ${value}`,
  });

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return invalid;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, RETURN_TO_BASE);
  } catch {
    return invalid;
  }

  if (parsed.origin !== RETURN_TO_BASE) {
    return invalid;
  }

  return success(`${parsed.pathname}${parsed.search}`);
}
