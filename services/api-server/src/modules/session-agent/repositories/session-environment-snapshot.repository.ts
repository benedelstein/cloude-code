import {
  SessionEnvironmentSnapshot,
  type SessionEnvironmentSnapshot as SessionEnvironmentSnapshotType,
} from "@repo/shared";
import type { Migration, Repository, SqlFn } from "./repository.types";

export class SessionEnvironmentSnapshotRepository implements Repository {
  readonly name = "session_environment_snapshot";
  readonly migrations: ReadonlyArray<Migration> = [
    (sql) => {
      sql`
        CREATE TABLE IF NOT EXISTS session_environment_snapshot (
          id TEXT PRIMARY KEY NOT NULL,
          snapshot TEXT NOT NULL
        )
      `;
    },
  ];

  constructor(private readonly sql: SqlFn) {}

  get(): SessionEnvironmentSnapshotType {
    const rows = this.sql<{ snapshot: string }>`
      SELECT snapshot FROM session_environment_snapshot WHERE id = 'snapshot'
    `;
    if (!rows[0]?.snapshot) {
      throw new Error("Session environment snapshot is missing");
    }

    return SessionEnvironmentSnapshot.parse(JSON.parse(rows[0].snapshot));
  }

  set(snapshot: SessionEnvironmentSnapshotType): void {
    this.sql`
      INSERT OR REPLACE INTO session_environment_snapshot (id, snapshot)
      VALUES ('snapshot', ${JSON.stringify(snapshot)})
    `;
  }
}
