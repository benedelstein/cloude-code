/**
 * Converts a JS Date to a SQLite-compatible datetime string (`YYYY-MM-DD HH:MM:SS`).
 * Useful for comparisons against D1 columns that use `datetime('now')` format.
 */
export function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Converts a SQLite `datetime('now')` value (`YYYY-MM-DD HH:MM:SS`, implicitly UTC
 * with no timezone designator) to an ISO8601 string with a trailing `Z`. Browsers
 * parse the SQLite format as local time, so clients must receive the `Z` form.
 */
export function fromSqliteDatetime(value: string): string;
export function fromSqliteDatetime(value: string | null): string | null;
export function fromSqliteDatetime(value: string | null): string | null {
  if (value === null) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) return value;
  return value.replace(" ", "T") + "Z";
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
