/**
 * Converts a JS Date to a SQLite-compatible datetime string (`YYYY-MM-DD HH:MM:SS`).
 * Useful for comparisons against D1 columns that use `datetime('now')` format.
 */
export function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
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
