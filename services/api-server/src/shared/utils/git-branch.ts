/**
 * Normalizes a branch name received from session state or API input.
 * Removes non-printable ASCII control characters and trims surrounding whitespace.
 */
export function sanitizeGitBranchName(branchName: string | null | undefined): string | null {
  const withoutControlCharacters = Array.from(branchName ?? "")
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();

  return withoutControlCharacters ? withoutControlCharacters : null;
}

/** Quotes a value for safe use as one shell argument. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
