import type { UIMessageChunk } from "ai";
import type { SqlFn, Repository } from "./types";

interface PendingChunkRow {
  id: number;
  chunk: string;
}

/**
 * Persists in-flight message chunks to SQLite as a write-ahead log.
 * Cleared on clean finish; used to recover partial messages after agent process
 * death or forced DO eviction.
 */
export class PendingChunkRepository implements Repository {
  constructor(private sql: SqlFn) {}

  migrate(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS pending_message_chunks (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk TEXT NOT NULL
      )
    `;
  }

  /** Appends a chunk to the WAL. */
  append(chunk: UIMessageChunk): void {
    const chunkJson = JSON.stringify(chunk);
    this.sql`INSERT INTO pending_message_chunks (chunk) VALUES (${chunkJson})`;
  }

  /** Returns all buffered chunks in insertion order. */
  getAll(): UIMessageChunk[] {
    const rows = this.sql<PendingChunkRow>`
      SELECT id, chunk FROM pending_message_chunks ORDER BY id ASC
    `;
    return rows.map((row) => JSON.parse(row.chunk) as UIMessageChunk);
  }

  /** Removes all buffered chunks. Call on clean finish or after recovery. */
  clear(): void {
    this.sql`DELETE FROM pending_message_chunks`;
  }
}
