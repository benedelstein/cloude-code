import {
  SessionRuntimeConfigSnapshot,
  type SessionRuntimeConfigSnapshot as SessionRuntimeConfigSnapshotType,
} from "@repo/shared";
import type { Migration, Repository, SqlFn } from "./repository.types";

export class SessionRuntimeConfigRepository implements Repository {
  readonly name = "session_runtime_config";
  readonly migrations: ReadonlyArray<Migration> = [
    (sql) => {
      sql`
        CREATE TABLE IF NOT EXISTS session_runtime_config (
          id TEXT PRIMARY KEY NOT NULL,
          config TEXT NOT NULL
        )
      `;
    },
  ];

  constructor(private readonly sql: SqlFn) {}

  get(): SessionRuntimeConfigSnapshotType {
    const rows = this.sql<{ config: string }>`
      SELECT config FROM session_runtime_config WHERE id = 'config'
    `;
    if (!rows[0]?.config) {
      throw new Error("Session runtime config is missing");
    }

    return SessionRuntimeConfigSnapshot.parse(JSON.parse(rows[0].config));
  }

  set(config: SessionRuntimeConfigSnapshotType): void {
    this.sql`
      INSERT OR REPLACE INTO session_runtime_config (id, config)
      VALUES ('config', ${JSON.stringify(config)})
    `;
  }
}
