import type { SqlFn, Repository } from "./types";

export interface StoredLatestPlan {
  sessionId: string;
  plan: string;
  sourceMessageId: string | null;
  updatedAt: string;
}

interface LatestPlanRow {
  session_id: string;
  plan_text: string;
  source_message_id: string | null;
  updated_at: string;
}

export class LatestPlanRepository implements Repository {
  constructor(private sql: SqlFn) {}

  migrate(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS latest_session_plans (
        session_id TEXT PRIMARY KEY,
        plan_text TEXT NOT NULL,
        source_message_id TEXT,
        updated_at TEXT NOT NULL
      )
    `;
  }

  upsert(sessionId: string, plan: string, sourceMessageId: string | null): StoredLatestPlan {
    const updatedAt = new Date().toISOString();

    this.sql`
      INSERT INTO latest_session_plans (session_id, plan_text, source_message_id, updated_at)
      VALUES (${sessionId}, ${plan}, ${sourceMessageId}, ${updatedAt})
      ON CONFLICT(session_id) DO UPDATE SET
        plan_text = excluded.plan_text,
        source_message_id = excluded.source_message_id,
        updated_at = excluded.updated_at
    `;

    return {
      sessionId,
      plan,
      sourceMessageId,
      updatedAt,
    };
  }

  getBySession(sessionId: string): StoredLatestPlan | null {
    const rows = this.sql<LatestPlanRow>`
      SELECT session_id, plan_text, source_message_id, updated_at
      FROM latest_session_plans
      WHERE session_id = ${sessionId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      plan: row.plan_text,
      sourceMessageId: row.source_message_id,
      updatedAt: row.updated_at,
    };
  }
}
