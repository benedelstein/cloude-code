import type { SessionStatus, SessionSummary } from "@repo/shared";

interface CreateSessionParams {
  id: string;
  userId: string;
  repoId: string;
  status: SessionStatus;
}

interface SessionRow {
  id: string;
  user_id: string;
  repo_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

function rowToSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    repoId: row.repo_id,
    title: row.title,
    status: row.status as SessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}

export class SessionHistoryService {
  constructor(private database: D1Database) {}

  async create(params: CreateSessionParams): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO sessions (id, user_id, repo_id, status) VALUES (?, ?, ?, ?)`,
      )
      .bind(params.id, params.userId, params.repoId, params.status)
      .run();
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(title, sessionId)
      .run();
  }

  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(status, sessionId)
      .run();
  }

  async updateLastMessageAt(sessionId: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(sessionId)
      .run();
  }

  async listByUser(
    userId: string,
    options: { repoId?: string; limit?: number; cursor?: string } = {},
  ): Promise<{ sessions: SessionSummary[]; cursor: string | null }> {
    const limit = Math.min(options.limit ?? 20, 50);

    let query: string;
    const bindings: (string | number)[] = [userId];

    if (options.repoId && options.cursor) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND repo_id = ? AND updated_at < ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(options.repoId, options.cursor, limit + 1);
    } else if (options.repoId) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND repo_id = ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(options.repoId, limit + 1);
    } else if (options.cursor) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND updated_at < ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(options.cursor, limit + 1);
    } else {
      query = `SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(limit + 1);
    }

    const result = await this.database
      .prepare(query)
      .bind(...bindings)
      .all<SessionRow>();

    const rows = result.results;
    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map(rowToSummary);
    const nextCursor = hasMore ? sessions[sessions.length - 1]?.updatedAt ?? null : null;

    return { sessions, cursor: nextCursor };
  }

  async getById(sessionId: string): Promise<SessionSummary | null> {
    const row = await this.database
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .bind(sessionId)
      .first<SessionRow>();

    return row ? rowToSummary(row) : null;
  }
}
