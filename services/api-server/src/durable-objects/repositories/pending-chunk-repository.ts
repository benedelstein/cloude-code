import type { UIMessageChunk } from "ai";
import type { SqlFn, Repository } from "./types";

interface PendingChunkRow {
  sequence: number;
  chunk: string;
}

/**
 * Persists in-flight message chunks to SQLite as a write-ahead log.
 * Cleared on clean finish; used to recover partial messages after agent process
 * death or forced DO eviction.
 *
 * `sequence` is the transport-level chunk sequence assigned by the vm-agent's
 * ChunkBatcher. It doubles as the primary key, which makes the WAL the source
 * of truth for chunk dedup: a duplicate retry hits a UNIQUE conflict and is
 * silently ignored.
 */
export class PendingChunkRepository implements Repository {
  constructor(private sql: SqlFn) {}

  migrate(): void {
    // Drop and recreate to add the sequence column. The WAL is best-effort
    // recovery and is cleared on every clean finish, so dropping it on deploy
    // only affects turns actively streaming at deploy time.
    this.sql`DROP TABLE IF EXISTS pending_message_chunks`;
    this.sql`
      CREATE TABLE IF NOT EXISTS pending_message_chunks (
        sequence INTEGER PRIMARY KEY,
        chunk    TEXT NOT NULL
      )
    `;
  }

  /**
   * I nserts a chunk into the WAL keyed by its transport sequence.
   * Returns true if a new row was written, false if a row with this sequence
   * already existed (duplicate retry). Callers must skip applying / broadcasting
   * the chunk when this returns false.
   */
  appendIfNew(chunk: UIMessageChunk, sequence: number): boolean {
    const chunkJson = JSON.stringify(chunk);
    const inserted = this.sql<{ sequence: number }>`
      INSERT INTO pending_message_chunks (sequence, chunk)
      VALUES (${sequence}, ${chunkJson})
      ON CONFLICT(sequence) DO NOTHING
      RETURNING sequence
    `;
    return inserted.length > 0;
  }

  /** Returns all buffered chunks paired with their sequence, ordered ascending. */
  getAll(): Array<{ sequence: number; chunk: UIMessageChunk }> {
    const rows = this.sql<PendingChunkRow>`
      SELECT sequence, chunk FROM pending_message_chunks ORDER BY sequence ASC
    `;
    return rows.map((row) => ({
      sequence: row.sequence,
      chunk: JSON.parse(row.chunk) as UIMessageChunk,
    }));
  }

  /** Removes all buffered chunks. Call on clean finish or after recovery. */
  clear(): void {
    this.sql`DELETE FROM pending_message_chunks`;
  }
}
