import type { Migration, SqlFn, Repository } from "./repository.types";

export type SetupOutputStream = "stdout" | "stderr";

/** Per-stream storage cap; output beyond this is dropped and flagged truncated. */
export const SETUP_OUTPUT_STORE_CAP = 1_000_000;
/**
 * Max chars per stored row. DO SQLite caps rows at 2 MB and TEXT is stored as
 * UTF-8 (up to 3 bytes per UTF-16 char), so appends are split and compaction
 * is skipped for streams that could exceed the row limit.
 */
const APPEND_ROW_MAX_CHARS = 64_000;
export const SETUP_OUTPUT_COMPACT_MAX_CHARS = 600_000;

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

  /** Appends one batch of output for a stream, split into row-size-safe segments. */
  append(stream: SetupOutputStream, data: string): void {
    let start = 0;
    while (start < data.length) {
      let end = Math.min(start + APPEND_ROW_MAX_CHARS, data.length);
      // Keep surrogate pairs within one row so stored text stays well-formed.
      if (end < data.length && isHighSurrogate(data.charCodeAt(end - 1))) {
        end += 1;
      }
      this.insertNextRow(stream, data.slice(start, end));
      start = end;
    }
  }

  private insertNextRow(stream: SetupOutputStream, data: string): void {
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

  /**
   * Collapses a stream's rows into a single row to keep long-lived state
   * compact. Skipped for streams that could exceed the DO SQLite row limit.
   */
  compact(stream: SetupOutputStream): void {
    if (this.totalLength(stream) > SETUP_OUTPUT_COMPACT_MAX_CHARS) {
      return;
    }
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

export function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
