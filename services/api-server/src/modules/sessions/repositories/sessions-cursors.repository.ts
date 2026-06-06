/**
 * Opaque keyset cursors for paginating the sidebar's grouped sessions list.
 *
 * Cursors round-trip the (timestamp, id) pair of the last row of the previous
 * page so the next page can resume with strict lexicographic comparison —
 * stable even when many rows share the same timestamp.
 *
 * Wire format: base64 of "<sqlite_ts>|<id>". The pipe separator is safe
 * because SQLite "YYYY-MM-DD HH:MM:SS" datetimes never contain "|".
 */

export interface RepoCursor {
  /** SQLite datetime string ("YYYY-MM-DD HH:MM:SS") for direct comparison. */
  maxCreatedAt: string;
  repoId: number;
}

export interface SessionCursor {
  /** SQLite datetime string ("YYYY-MM-DD HH:MM:SS") for direct comparison. */
  createdAt: string;
  sessionId: string;
}

export function encodeRepoCursor(cursor: RepoCursor): string {
  return btoa(`${cursor.maxCreatedAt}|${cursor.repoId}`);
}

/**
 * Decodes a repo cursor. Returns `null` for malformed input — callers should
 * treat that as "no cursor" and return the first page rather than erroring.
 */
export function decodeRepoCursor(cursor: string): RepoCursor | null {
  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    return null;
  }
  const pipeIndex = decoded.lastIndexOf("|");
  if (pipeIndex < 0) { return null; }
  const maxCreatedAt = decoded.slice(0, pipeIndex);
  const repoId = Number.parseInt(decoded.slice(pipeIndex + 1), 10);
  if (!maxCreatedAt || !Number.isFinite(repoId)) { return null; }
  return { maxCreatedAt, repoId };
}

export function encodeSessionCursor(cursor: SessionCursor): string {
  return btoa(`${cursor.createdAt}|${cursor.sessionId}`);
}

/**
 * Decodes a session cursor. Returns `null` for malformed input — callers
 * should treat that as "no cursor" and return the first page rather than
 * erroring.
 */
export function decodeSessionCursor(cursor: string): SessionCursor | null {
  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    return null;
  }
  const pipeIndex = decoded.lastIndexOf("|");
  if (pipeIndex < 0) { return null; }
  const createdAt = decoded.slice(0, pipeIndex);
  const sessionId = decoded.slice(pipeIndex + 1);
  if (!createdAt || !sessionId) { return null; }
  return { createdAt, sessionId };
}
