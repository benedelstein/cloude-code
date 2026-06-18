import type { UIMessageChunk } from "ai";
import type { Migration, SqlFn, Repository } from "./repository.types";

interface PendingChunkRow {
  sequence: number;
  chunk: string;
  received_at: number | null;
}

export interface PendingChunkRecord {
  sequence: number;
  chunk: UIMessageChunk;
  receivedAt: number;
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
  readonly name = "pending_message_chunks";
  readonly migrations: ReadonlyArray<Migration> = [
    // v0: replace any pre-existing chunk-only table with a sequence-keyed WAL.
    // Tracked in `schema_migrations`, so this destructive step runs at most
    // once per DO. New DOs land directly on this shape; previously-deployed
    // DOs lose any in-flight WAL on first cold start under this version.
    (sql) => {
      sql`DROP TABLE IF EXISTS pending_message_chunks`;
      sql`
        CREATE TABLE pending_message_chunks (
          sequence INTEGER PRIMARY KEY,
          chunk    TEXT NOT NULL
        )
      `;
    },
    (sql) => {
      sql`
        ALTER TABLE pending_message_chunks
        ADD COLUMN received_at INTEGER
      `;
      sql`
        UPDATE pending_message_chunks
        SET received_at = ${Date.now()}
        WHERE received_at IS NULL
      `;
    },
  ];

  constructor(private sql: SqlFn) {}

  /**
   * I nserts a chunk into the WAL keyed by its transport sequence.
   * Returns true if a new row was written, false if a row with this sequence
   * already existed (duplicate retry). Callers must skip applying / broadcasting
   * the chunk when this returns false.
   */
  appendIfNew(
    chunk: UIMessageChunk,
    sequence: number,
    receivedAt: number,
  ): boolean {
    // Stored JSON is AI SDK UI state, not Wire DTO output. Do not normalize through Wire schemas here.
    const chunkJson = JSON.stringify(chunk);
    const inserted = this.sql<{ sequence: number }>`
      INSERT INTO pending_message_chunks (sequence, chunk, received_at)
      VALUES (${sequence}, ${chunkJson}, ${receivedAt})
      ON CONFLICT(sequence) DO NOTHING
      RETURNING sequence
    `;
    return inserted.length > 0;
  }

  /** Returns all buffered chunks paired with their sequence, ordered ascending. */
  getAll(): PendingChunkRecord[] {
    const rows = this.sql<PendingChunkRow>`
      SELECT sequence, chunk, received_at FROM pending_message_chunks ORDER BY sequence ASC
    `;
    return rows.map((row) => ({
      sequence: row.sequence,
      chunk: JSON.parse(row.chunk) as UIMessageChunk,
      receivedAt: row.received_at ?? Date.now(),
    }));
  }

  /** Removes all buffered chunks. Call on clean finish or after recovery. */
  clear(): void {
    this.sql`DELETE FROM pending_message_chunks`;
  }
}
