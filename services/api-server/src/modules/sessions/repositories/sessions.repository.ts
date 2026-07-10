import type {
  IntegrationProvider,
  ProviderId,
  PullRequestState,
  SessionAccessBlockReason,
  SessionRepoGroup,
  SessionSummary,
  SessionWorkingState,
} from "@repo/shared";
import { fromSqliteDatetime } from "@/shared/utils/utils";
import {
  decodeRepoCursor,
  decodeSessionCursor,
  encodeRepoCursor,
  encodeSessionCursor,
} from "./sessions-cursors.repository";

// How a session was created. Set server-side per entry point, never from
// client input.
export type SessionSource = "web" | IntegrationProvider;

export interface CreateSessionParams {
  id: string;
  userId: string;
  repoId: number;
  installationId: number;
  repoFullName: string;
  source: SessionSource;
  provider: ProviderId;
  sourceEnvironmentId?: string | null;
  sourceEnvironmentName?: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  repo_id: number;
  installation_id: number | null;
  repo_full_name: string;
  provider_id: ProviderId | null;
  title: string | null;
  archived: number;
  access_blocked_at: string | null;
  access_block_reason: SessionAccessBlockReason | null;
  working_state: SessionWorkingState;
  pushed_branch: string | null;
  pull_request_url: string | null;
  pull_request_number: number | null;
  pull_request_state: PullRequestState | null;
  source_environment_id: string | null;
  source_environment_name: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  last_assistant_message_id: string | null;
  last_assistant_message_at: string | null;
  last_read_message_id: string | null;
  last_read_at: string | null;
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

export interface SessionPullRequestRow {
  id: string;
  userId: string;
}

function rowToSummary(row: SessionRow): SessionSummary {
  const pullRequest = row.pull_request_url
    && row.pull_request_number !== null
    && row.pull_request_state
    ? {
        url: row.pull_request_url,
        number: row.pull_request_number,
        state: row.pull_request_state,
      }
    : null;

  return {
    id: row.id,
    repoId: row.repo_id,
    repoFullName: row.repo_full_name,
    provider: row.provider_id ?? undefined,
    title: row.title,
    archived: row.archived === 1,
    workingState: row.working_state,
    pushedBranch: row.pushed_branch,
    pullRequest,
    createdAt: fromSqliteDatetime(row.created_at),
    updatedAt: fromSqliteDatetime(row.updated_at),
    lastMessageAt: fromSqliteDatetime(row.last_message_at),
    lastAssistantMessageId: row.last_assistant_message_id,
    // on mark read, we only update if the message matches the latest assistant message.
    hasUnread: row.last_assistant_message_id !== null &&
      row.last_read_message_id !== row.last_assistant_message_id,
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
        `INSERT INTO sessions (
           id,
           user_id,
           repo_id,
           installation_id,
           repo_full_name,
           source,
           provider_id,
           source_environment_id,
           source_environment_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.id,
        params.userId,
        params.repoId,
        params.installationId,
        params.repoFullName,
        params.source,
        params.provider,
        params.sourceEnvironmentId ?? null,
        params.sourceEnvironmentName ?? null,
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

  async updateWorkingState(
    sessionId: string,
    workingState: SessionWorkingState,
  ): Promise<void> {
    await this.database
      .prepare(`UPDATE sessions SET working_state = ? WHERE id = ?`)
      .bind(workingState, sessionId)
      .run();
  }

  async recordAssistantTurnFinished(
    sessionId: string,
    messageId: string,
    messageCreatedAt: string,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions
         SET working_state = 'idle',
             last_assistant_message_id = ?,
             last_assistant_message_at = ?,
             last_message_at = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(messageId, messageCreatedAt, messageCreatedAt, sessionId)
      .run();
  }

  /**
   * Updates a session's last read message id and timestamp.
   * Only updates if the passed in messageId matches the latest assistant message id.
   * @param sessionId 
   * @param messageId 
   */
  async markRead(sessionId: string, messageId: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions
         SET last_read_message_id = ?,
             last_read_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?
           AND last_assistant_message_id = ?`,
      )
      .bind(messageId, sessionId, messageId)
      .run();
  }

  async updatePushedBranch(
    sessionId: string,
    pushedBranch: string,
  ): Promise<void> {
    await this.database
      .prepare(`UPDATE sessions SET pushed_branch = ? WHERE id = ?`)
      .bind(pushedBranch, sessionId)
      .run();
  }

  async setPullRequest(
    sessionId: string,
    pullRequest: {
      url: string;
      number: number;
      state: PullRequestState;
    },
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions
         SET pull_request_url = ?,
             pull_request_number = ?,
             pull_request_state = ?
         WHERE id = ?`,
      )
      .bind(
        pullRequest.url,
        pullRequest.number,
        pullRequest.state,
        sessionId,
      )
      .run();
  }

  async updatePullRequestState(
    sessionId: string,
    state: PullRequestState,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE sessions SET pull_request_state = ? WHERE id = ? AND pull_request_number IS NOT NULL`,
      )
      .bind(state, sessionId)
      .run();
  }

  /**
   * Finds sessions currently associated with a GitHub pull request.
   * @param params - GitHub installation, repository, and pull request number.
   * @returns Matching session and user ids without mutating session summary state.
   */
  async findSessionsByPullRequest(params: {
    installationId: number;
    repoId: number;
    number: number;
  }): Promise<SessionPullRequestRow[]> {
    const result = await this.database
      .prepare(
        `SELECT id, user_id
         FROM sessions
         WHERE installation_id = ?
           AND repo_id = ?
           AND pull_request_number = ?`,
      )
      .bind(
        params.installationId,
        params.repoId,
        params.number,
      )
      .all<{ id: string; user_id: string }>();

    return result.results.map((row) => ({
      id: row.id,
      userId: row.user_id,
    }));
  }

  /**
   * Lists the user's non-archived sessions grouped by repository.
   *
   * Repos are ordered by their most recently created session. Within each
   * group, sessions are also ordered by `created_at` DESC. Each group includes
   * up to `sessionLimit` sessions and a per-repo `nextSessionCursor` to load
   * more sessions for that repo via {@link listSessionsForRepo}.
   *
   * Pagination of the repo list uses a keyset cursor on
   * `(MAX(created_at), repo_id)` to keep ordering stable when multiple repos
   * share the same most-recent timestamp.
   *
   * @returns Page of repo groups and an optional cursor for the next page.
   */
  async listGroupedByUser(
    userId: string,
    options: {
      repoCursor?: string;
      repoLimit?: number;
      sessionLimit?: number;
    } = {},
  ): Promise<{ groups: SessionRepoGroup[]; nextRepoCursor: string | null }> {
    const repoLimit = Math.min(options.repoLimit ?? 10, 50);
    const sessionLimit = Math.min(options.sessionLimit ?? 5, 50);

    const decodedRepoCursor = options.repoCursor
      ? decodeRepoCursor(options.repoCursor)
      : null;

    // Step 1: page of repos, ordered by newest session creation.
    // Keyset filter uses lexicographic comparison: prefer rows with strictly
    // older max_created_at, and break ties by smaller repo_id.
    let repoQuery: string;
    const repoBindings: (string | number)[] = [userId];
    if (decodedRepoCursor) {
      repoQuery = `
        SELECT repo_id, MAX(created_at) AS max_created_at
        FROM sessions
        WHERE user_id = ? AND archived = 0
        GROUP BY repo_id
        HAVING max_created_at < ?
           OR (max_created_at = ? AND repo_id < ?)
        ORDER BY max_created_at DESC, repo_id DESC
        LIMIT ?
      `;
      repoBindings.push(
        decodedRepoCursor.maxCreatedAt,
        decodedRepoCursor.maxCreatedAt,
        decodedRepoCursor.repoId,
        repoLimit + 1,
      );
    } else {
      repoQuery = `
        SELECT repo_id, MAX(created_at) AS max_created_at
        FROM sessions
        WHERE user_id = ? AND archived = 0
        GROUP BY repo_id
        ORDER BY max_created_at DESC, repo_id DESC
        LIMIT ?
      `;
      repoBindings.push(repoLimit + 1);
    }

    const repoResult = await this.database
      .prepare(repoQuery)
      .bind(...repoBindings)
      .all<{ repo_id: number; max_created_at: string }>();

    const repoRows = repoResult.results;
    const hasMoreRepos = repoRows.length > repoLimit;
    const pagedRepoRows = repoRows.slice(0, repoLimit);

    if (pagedRepoRows.length === 0) {
      return { groups: [], nextRepoCursor: null };
    }

    // Step 2: top-N sessions per repo for the paged repo set. Window function
    // limits per-group rows in a single round-trip; fetch sessionLimit + 1 to
    // detect "has more" within each group.
    const repoIds = pagedRepoRows.map((row) => row.repo_id);
    const placeholders = repoIds.map(() => "?").join(", ");
    const sessionQuery = `
      SELECT * FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY repo_id ORDER BY created_at DESC, id DESC) AS rn
        FROM sessions
        WHERE user_id = ? AND archived = 0 AND repo_id IN (${placeholders})
      )
      WHERE rn <= ?
      ORDER BY repo_id, rn
    `;
    const sessionResult = await this.database
      .prepare(sessionQuery)
      .bind(userId, ...repoIds, sessionLimit + 1)
      .all<SessionRow & { rn: number }>();

    // Bucket session rows by repo_id, preserving the rn order from SQL.
    const sessionsByRepo = new Map<number, SessionRow[]>();
    for (const row of sessionResult.results) {
      const bucket = sessionsByRepo.get(row.repo_id) ?? [];
      bucket.push(row);
      sessionsByRepo.set(row.repo_id, bucket);
    }

    const groups: SessionRepoGroup[] = pagedRepoRows.map((repoRow) => {
      const repoSessions = sessionsByRepo.get(repoRow.repo_id) ?? [];
      const hasMoreSessions = repoSessions.length > sessionLimit;
      const visibleRows = repoSessions.slice(0, sessionLimit);
      const summaries = visibleRows.map(rowToSummary);
      // Most-recent session row's repo_full_name reflects the latest known
      // name for this repo (handles renames as messages flow through).
      const repoFullName =
        visibleRows[0]?.repo_full_name ?? "";
      const lastVisible = visibleRows[visibleRows.length - 1];
      const nextSessionCursor =
        hasMoreSessions && lastVisible
          ? encodeSessionCursor({
              createdAt: lastVisible.created_at,
              sessionId: lastVisible.id,
            })
          : null;
      return {
        repoId: repoRow.repo_id,
        repoFullName,
        sessions: summaries,
        nextSessionCursor,
      };
    });

    const lastRepo = pagedRepoRows[pagedRepoRows.length - 1];
    const nextRepoCursor =
      hasMoreRepos && lastRepo
        ? encodeRepoCursor({
            maxCreatedAt: lastRepo.max_created_at,
            repoId: lastRepo.repo_id,
          })
        : null;

    return { groups, nextRepoCursor };
  }

  /**
   * Lists a single repo's non-archived sessions, paginated by an opaque
   * session cursor. Returns the result wrapped as a single-group response so
   * callers can treat it uniformly with {@link listGroupedByUser}.
   */
  async listSessionsForRepo(
    userId: string,
    repoId: number,
    options: { sessionCursor?: string; sessionLimit?: number } = {},
  ): Promise<SessionRepoGroup | null> {
    const sessionLimit = Math.min(options.sessionLimit ?? 5, 50);
    const decoded = options.sessionCursor
      ? decodeSessionCursor(options.sessionCursor)
      : null;

    let query: string;
    const bindings: (string | number)[] = [userId, repoId];
    if (decoded) {
      query = `
        SELECT * FROM sessions
        WHERE user_id = ? AND repo_id = ? AND archived = 0
          AND (created_at < ?
            OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `;
      bindings.push(
        decoded.createdAt,
        decoded.createdAt,
        decoded.sessionId,
        sessionLimit + 1,
      );
    } else {
      query = `
        SELECT * FROM sessions
        WHERE user_id = ? AND repo_id = ? AND archived = 0
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `;
      bindings.push(sessionLimit + 1);
    }

    const result = await this.database
      .prepare(query)
      .bind(...bindings)
      .all<SessionRow>();

    const rows = result.results;
    if (rows.length === 0) {
      return null;
    }

    const hasMore = rows.length > sessionLimit;
    const visibleRows = rows.slice(0, sessionLimit);
    const summaries = visibleRows.map(rowToSummary);
    const lastVisible = visibleRows[visibleRows.length - 1];
    const nextSessionCursor =
      hasMore && lastVisible
        ? encodeSessionCursor({
            createdAt: lastVisible.created_at,
            sessionId: lastVisible.id,
          })
        : null;

    return {
      repoId,
      repoFullName: visibleRows[0]?.repo_full_name ?? "",
      sessions: summaries,
      nextSessionCursor,
    };
  }

  async getById(sessionId: string): Promise<SessionSummary | null> {
    const row = await this.database
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .bind(sessionId)
      .first<SessionRow>();

    return row ? rowToSummary(row) : null;
  }

  async getByIdForUser(
    sessionId: string,
    userId: string,
  ): Promise<SessionSummary | null> {
    const row = await this.database
      .prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`)
      .bind(sessionId, userId)
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
