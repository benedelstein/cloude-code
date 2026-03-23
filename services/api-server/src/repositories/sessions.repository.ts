import type { SessionSummary } from "@repo/shared";

export interface CreateSessionParams {
  id: string;
  userId: string;
  repoId: number;
  installationId: number;
  repoFullName: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  repo_id: number;
  installation_id: number | null;
  repo_full_name: string;
  title: string | null;
  archived: number;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface SessionAccessRow {
  id: string;
  userId: string;
  repoId: number;
  installationId: number | null;
  repoFullName: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

function rowToSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    repoId: row.repo_id,
    repoFullName: row.repo_full_name,
    title: row.title,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}

export class SessionsRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(params: CreateSessionParams): Promise<void> {
    await this.database.prepare(
      `INSERT INTO sessions (id, user_id, repo_id, installation_id, repo_full_name) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        params.id,
        params.userId,
        params.repoId,
        params.installationId,
        params.repoFullName,
      )
      .run();
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    await this.database.prepare(
      `UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(title, sessionId)
      .run();
  }

  async archive(sessionId: string): Promise<void> {
    await this.database.prepare(
      `UPDATE sessions SET archived = 1, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(sessionId)
      .run();
  }

  async delete(sessionId: string): Promise<void> {
    await this.database.prepare(`DELETE FROM sessions WHERE id = ?`)
      .bind(sessionId)
      .run();
  }

  async deleteAndQueueAttachmentGc(sessionId: string): Promise<void> {
    await this.database.batch([
      this.database.prepare(
        `INSERT INTO attachment_gc_queue (object_key, retry_count, created_at, updated_at)
         SELECT object_key, 0, datetime('now'), datetime('now')
         FROM attachments
         WHERE session_id = ?
         ON CONFLICT(object_key) DO UPDATE SET
           retry_count = 0,
           last_error = NULL,
           updated_at = datetime('now')`,
      ).bind(sessionId),
      this.database.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId),
    ]);
  }

  async updateLastMessageAt(sessionId: string): Promise<void> {
    await this.database.prepare(
      `UPDATE sessions SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(sessionId)
      .run();
  }

  async listByUser(
    userId: string,
    options: { repoId?: number; limit?: number; cursor?: string } = {},
  ): Promise<{ sessions: SessionSummary[]; cursor: string | null }> {
    const limit = Math.min(options.limit ?? 20, 50);

    let query: string;
    const bindings: (string | number)[] = [userId];

    if (options.repoId && options.cursor) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND archived = 0 AND repo_id = ? AND updated_at < ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(options.repoId, options.cursor, limit + 1);
    } else if (options.repoId) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND archived = 0 AND repo_id = ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(options.repoId, limit + 1);
    } else if (options.cursor) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND archived = 0 AND updated_at < ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(options.cursor, limit + 1);
    } else {
      query = `SELECT * FROM sessions WHERE user_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(limit + 1);
    }

    const result = await this.database.prepare(query)
      .bind(...bindings)
      .all<SessionRow>();

    const rows = result.results;
    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map(rowToSummary);
    const nextCursor = hasMore ? sessions[sessions.length - 1]?.updatedAt ?? null : null;

    return { sessions, cursor: nextCursor };
  }

  async getById(sessionId: string): Promise<SessionSummary | null> {
    const row = await this.database.prepare(`SELECT * FROM sessions WHERE id = ?`)
      .bind(sessionId)
      .first<SessionRow>();

    return row ? rowToSummary(row) : null;
  }

  async getAccessRowForUser(
    sessionId: string,
    userId: string,
  ): Promise<SessionAccessRow | null> {
    const row = await this.database.prepare(
      `SELECT id, user_id, repo_id, installation_id, repo_full_name, revoked_at, revoked_reason
       FROM sessions
       WHERE id = ? AND user_id = ?`,
    )
      .bind(sessionId, userId)
      .first<SessionRow>();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      repoId: row.repo_id,
      installationId: row.installation_id,
      repoFullName: row.repo_full_name,
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason,
    };
  }

  async updateInstallationId(sessionId: string, installationId: number): Promise<void> {
    await this.database.prepare(
      `UPDATE sessions SET installation_id = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(installationId, sessionId)
      .run();
  }

  async markRevoked(sessionId: string, reason: string): Promise<void> {
    await this.database.prepare(
      `UPDATE sessions
       SET revoked_at = COALESCE(revoked_at, datetime('now')),
           revoked_reason = COALESCE(revoked_reason, ?),
           updated_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(reason, sessionId)
      .run();
  }

  async isOwnedByUser(sessionId: string, userId: string): Promise<boolean> {
    const row = await this.database.prepare(
      `SELECT 1 as owned FROM sessions WHERE id = ? AND user_id = ?`,
    )
      .bind(sessionId, userId)
      .first<{ owned: number }>();

    return Boolean(row?.owned);
  }
}
