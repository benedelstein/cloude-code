import type { Repository, SqlFn } from "./types";

interface AppliedRow {
  version: number;
}

/**
 * Runs each repository's pending migrations and records applied versions in a
 * `schema_migrations(repo, version)` table. Already-applied migrations are
 * skipped on subsequent cold starts, so a destructive migration (e.g. drop /
 * recreate) only runs once per DO.
 *
 * Each (step + bookkeeping insert) pair runs inside `transactionSync` so a
 * partial failure rolls back the schema change. Durable Objects require the
 * JS transaction API rather than raw SQL `BEGIN`/`COMMIT`.
 */
export function migrateAll(
  sql: SqlFn,
  storage: DurableObjectStorage,
  repositories: Repository[],
): void {
  sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      repo TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (repo, version)
    )
  `;

  for (const repo of repositories) {
    const rows = sql<AppliedRow>`
      SELECT version FROM schema_migrations WHERE repo = ${repo.name}
    `;
    const maxApplied =
      rows.length > 0 ? Math.max(...rows.map((row) => row.version)) : -1;

    repo.migrations.forEach((step, index) => {
      if (index <= maxApplied) return;
      storage.transactionSync(() => {
        step(sql);
        sql`
          INSERT INTO schema_migrations (repo, version)
          VALUES (${repo.name}, ${index})
        `;
      });
    });
  }
}
