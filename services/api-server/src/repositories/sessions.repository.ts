import type { SessionAccessBlockReason, SessionSummary } from "@repo/shared";
import { fromSqliteDatetime, toSqliteDatetime } from "@/lib/utils/utils";

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
  access_blocked_at: string | null;
  access_block_reason: SessionAccessBlockReason | null;
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
  accessBlockedAt: string | null;
  accessBlockReason: SessionAccessBlockReason | null;
}

function rowToSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    repoId: row.repo_id,
    repoFullName: row.repo_full_name,
    title: row.title,
    archived: row.archived === 1,
    createdAt: fromSqliteDatetime(row.created_at),
    updatedAt: fromSqliteDatetime(row.updated_at),
    lastMessageAt: fromSqliteDatetime(row.last_message_at),
  };
}

export class SessionsRepository {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async create(params: CreateSessionParams): Promise<void> {
    await this.database
      .prepare(
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
    await this.database
      .prepare(
        `UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(title, sessionId)
      .run();
  }

  async archive(sessionId: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions SET archived = 1, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(sessionId)
      .run();
  }

  async delete(sessionId: string): Promise<void> {
    await this.database
      .prepare(`DELETE FROM sessions WHERE id = ?`)
      .bind(sessionId)
      .run();
  }

  async deleteAndQueueAttachmentGc(sessionId: string): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO attachment_gc_queue (object_key, retry_count, created_at, updated_at)
         SELECT object_key, 0, datetime('now'), datetime('now')
         FROM attachments
         WHERE session_id = ?
         ON CONFLICT(object_key) DO UPDATE SET
           retry_count = 0,
           last_error = NULL,
           updated_at = datetime('now')`,
        )
        .bind(sessionId),
      this.database
        .prepare(`DELETE FROM sessions WHERE id = ?`)
        .bind(sessionId),
    ]);
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
    options: { repoId?: number; limit?: number; cursor?: string } = {},
  ): Promise<{ sessions: SessionSummary[]; cursor: string | null }> {
    const limit = Math.min(options.limit ?? 20, 50);

    let query: string;
    const bindings: (string | number)[] = [userId];
    // Cursor is the ISO-with-Z form sent to clients; convert back to SQLite's
    // "YYYY-MM-DD HH:MM:SS" format so lexical comparison against updated_at works.
    const cursorForQuery = options.cursor
      ? toSqliteDatetime(new Date(options.cursor))
      : null;

    if (options.repoId && cursorForQuery) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND archived = 0 AND repo_id = ? AND updated_at < ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(options.repoId, cursorForQuery, limit + 1);
    } else if (options.repoId) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND archived = 0 AND repo_id = ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(options.repoId, limit + 1);
    } else if (cursorForQuery) {
      query = `SELECT * FROM sessions WHERE user_id = ? AND archived = 0 AND updated_at < ? ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(cursorForQuery, limit + 1);
    } else {
      query = `SELECT * FROM sessions WHERE user_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT ?`;
      bindings.push(limit + 1);
    }

    const result = await this.database
      .prepare(query)
      .bind(...bindings)
      .all<SessionRow>();

    const rows = result.results;
    const hasMore = rows.length > limit;
    const sessions = rows.slice(0, limit).map(rowToSummary);
    const nextCursor = hasMore
      ? (sessions[sessions.length - 1]?.updatedAt ?? null)
      : null;

    return { sessions, cursor: nextCursor };
  }

  async getById(sessionId: string): Promise<SessionSummary | null> {
    const row = await this.database
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .bind(sessionId)
      .first<SessionRow>();

    return row ? rowToSummary(row) : null;
  }

  async getAccessRowForUser(
    sessionId: string,
    userId: string,
  ): Promise<SessionAccessRow | null> {
    const row = await this.database
      .prepare(
        `SELECT id, user_id, repo_id, installation_id, repo_full_name, access_blocked_at, access_block_reason
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
      accessBlockedAt: row.access_blocked_at,
      accessBlockReason: row.access_block_reason,
    };
  }

  async clearAccessBlockAndUpdateBinding(
    sessionId: string,
    params: {
      installationId: number;
      repoFullName: string;
    },
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions
       SET installation_id = ?,
           repo_full_name = ?,
           access_blocked_at = NULL,
           access_block_reason = NULL,
           updated_at = datetime('now')
       WHERE id = ?`,
      )
      .bind(params.installationId, params.repoFullName, sessionId)
      .run();
  }

  async blockSessionForAccessCheckDenied(
    sessionId: string,
    options: {
      clearInstallationId: boolean;
      preserveExistingBlockReason: boolean;
    },
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions
       SET installation_id = CASE WHEN ? = 1 THEN NULL ELSE installation_id END,
           access_blocked_at = COALESCE(access_blocked_at, datetime('now')),
           access_block_reason = CASE
             WHEN ? = 1 THEN COALESCE(access_block_reason, ?)
             ELSE ?
           END,
           updated_at = datetime('now')
       WHERE id = ?`,
      )
      .bind(
        options.clearInstallationId ? 1 : 0,
        options.preserveExistingBlockReason ? 1 : 0,
        "ACCESS_CHECK_DENIED",
        "ACCESS_CHECK_DENIED",
        sessionId,
      )
      .run();
  }

  async blockSessionsForDeletedInstallation(
    installationId: number,
  ): Promise<string[]> {
    const sessionIds = await this.listSessionIdsForQuery(
      `SELECT id FROM sessions WHERE installation_id = ?`,
      [installationId],
    );
    if (sessionIds.length === 0) {
      return sessionIds;
    }

    await this.database
      .prepare(
        `UPDATE sessions
       SET installation_id = NULL,
           access_blocked_at = COALESCE(access_blocked_at, datetime('now')),
           access_block_reason = 'INSTALLATION_DELETED',
           updated_at = datetime('now')
       WHERE installation_id = ?`,
      )
      .bind(installationId)
      .run();

    return sessionIds;
  }

  async blockSessionsForSuspendedInstallation(
    installationId: number,
  ): Promise<string[]> {
    const sessionIds = await this.listSessionIdsForQuery(
      `SELECT id FROM sessions WHERE installation_id = ?`,
      [installationId],
    );
    if (sessionIds.length === 0) {
      return sessionIds;
    }

    await this.database
      .prepare(
        `UPDATE sessions
       SET access_blocked_at = COALESCE(access_blocked_at, datetime('now')),
           access_block_reason = 'INSTALLATION_SUSPENDED',
           updated_at = datetime('now')
       WHERE installation_id = ?`,
      )
      .bind(installationId)
      .run();

    return sessionIds;
  }

  async blockSessionsForRemovedRepos(
    installationId: number,
    repoIds: number[],
  ): Promise<string[]> {
    if (repoIds.length === 0) {
      return [];
    }

    const placeholders = repoIds.map(() => "?").join(", ");
    const bindings: (string | number)[] = [installationId, ...repoIds];
    const sessionIds = await this.listSessionIdsForQuery(
      `SELECT id FROM sessions
       WHERE installation_id = ?
         AND repo_id IN (${placeholders})`,
      bindings,
    );
    if (sessionIds.length === 0) {
      return sessionIds;
    }

    await this.database
      .prepare(
        `UPDATE sessions
       SET access_blocked_at = COALESCE(access_blocked_at, datetime('now')),
           access_block_reason = 'REPO_REMOVED_FROM_INSTALLATION',
           updated_at = datetime('now')
       WHERE installation_id = ?
         AND repo_id IN (${placeholders})`,
      )
      .bind(installationId, ...repoIds)
      .run();

    return sessionIds;
  }

  /**
   * Counts sessions created by a user since the given datetime.
   * @param userId - The user whose sessions to count.
   * @param since - ISO datetime string; only sessions with created_at > since are counted.
   */
  async countRecentByUser(userId: string, since: string): Promise<number> {
    const row = await this.database
      .prepare(
        `SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND created_at > ?`,
      )
      .bind(userId, since)
      .first<{ count: number }>();

    return row?.count ?? 0;
  }

  async isOwnedByUser(sessionId: string, userId: string): Promise<boolean> {
    const row = await this.database
      .prepare(`SELECT 1 as owned FROM sessions WHERE id = ? AND user_id = ?`)
      .bind(sessionId, userId)
      .first<{ owned: number }>();

    return Boolean(row?.owned);
  }

  private async listSessionIdsForQuery(
    query: string,
    bindings: (string | number)[],
  ): Promise<string[]> {
    const result = await this.database
      .prepare(query)
      .bind(...bindings)
      .all<{ id: string }>();

    return result.results.map((row) => row.id);
  }
}
