import type { Migration, SqlFn, Repository } from "./repository.types";

export type SetupOutputStream = "stdout" | "stderr";

/** Per-stream storage cap; output beyond this is dropped and flagged truncated. */
export const SETUP_OUTPUT_STORE_CAP = 1_000_000;

/**
 * Persists setup-script output to SQLite, separate from ClientState so large
 * output never inflates synced state. Rows are appended per flushed batch while
 * the script runs and compacted to one row per stream when it finishes; full
 * output is read back on demand (fetch endpoint) rather than streamed from here.
 */
export class SetupOutputRepository implements Repository {
  readonly name = "setup_script_output_chunks";
  readonly migrations: ReadonlyArray<Migration> = [
    (sql) => {
      sql`
        CREATE TABLE IF NOT EXISTS setup_script_output_chunks (
          stream TEXT NOT NULL,
          seq    INTEGER NOT NULL,
          data   TEXT NOT NULL,
          PRIMARY KEY (stream, seq)
        )
      `;
    },
  ];

  constructor(private sql: SqlFn) {}

  /** Appends one batch of output for a stream at the next sequence number. */
  append(stream: SetupOutputStream, data: string): void {
    this.sql`
      INSERT INTO setup_script_output_chunks (stream, seq, data)
      VALUES (
        ${stream},
        (SELECT COALESCE(MAX(seq), -1) + 1 FROM setup_script_output_chunks WHERE stream = ${stream}),
        ${data}
      )
    `;
  }

  /** Returns the full accumulated output for a stream, in append order. */
  read(stream: SetupOutputStream): string {
    const rows = this.sql<{ data: string }>`
      SELECT data FROM setup_script_output_chunks WHERE stream = ${stream} ORDER BY seq ASC
    `;
    return rows.map((row) => row.data).join("");
  }

  /** Returns the total stored chars for a stream. */
  totalLength(stream: SetupOutputStream): number {
    const rows = this.sql<{ total: number | null }>`
      SELECT SUM(LENGTH(data)) AS total FROM setup_script_output_chunks WHERE stream = ${stream}
    `;
    return rows[0]?.total ?? 0;
  }

  /** True when any output rows exist for either stream. */
  hasOutput(): boolean {
    const rows = this.sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM setup_script_output_chunks
    `;
    return (rows[0]?.count ?? 0) > 0;
  }

  /** Collapses a stream's rows into a single row to keep long-lived state compact. */
  compact(stream: SetupOutputStream): void {
    const data = this.read(stream);
    this.sql`DELETE FROM setup_script_output_chunks WHERE stream = ${stream}`;
    if (data.length > 0) {
      this.sql`
        INSERT INTO setup_script_output_chunks (stream, seq, data)
        VALUES (${stream}, 0, ${data})
      `;
    }
  }

  /** Removes all stored output. Call before each script run. */
  clear(): void {
    this.sql`DELETE FROM setup_script_output_chunks`;
  }
}
