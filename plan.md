# Chat History Persistence - Implementation Plan

## Goal
Allow users to see their past sessions and resume them, similar to Claude Code's session history. Sessions need a D1 record with user ID, repo name, a human-readable title (derived from the first message), and status tracking.

## Current State
- Session state lives entirely in Durable Objects (AgentState) — no cross-session index exists
- Messages are stored in each DO's SQLite — not in D1
- D1 already has `users`, `auth_sessions`, and GitHub installation tables
- There is no `GET /sessions` (list) endpoint — only `GET /sessions/:id` (single session info)
- When sessions are deleted, the DO state is set to "terminated" and messages are cleared

## Changes

### 1. D1 Migration — `0003_sessions.sql`
**File:** `services/api-server/migrations/0003_sessions.sql`

Create a new `sessions` table in D1:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                -- session UUID (matches DO session ID)
  user_id TEXT NOT NULL,              -- FK to users.id
  repo_id TEXT NOT NULL,              -- e.g. "owner/repo"
  title TEXT,                         -- human-readable summary, derived from first user message
  status TEXT NOT NULL DEFAULT 'provisioning',  -- mirrors SessionStatus
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT                -- timestamp of last chat message
);

CREATE INDEX idx_sessions_user ON sessions(user_id, updated_at);
CREATE INDEX idx_sessions_user_repo ON sessions(user_id, repo_id, updated_at);
```

This table acts as a lightweight index for listing sessions. The full message history stays in the DO's SQLite.

### 2. Session Repository (D1)
**File:** `services/api-server/src/lib/session-history.ts`

Create a `SessionHistoryService` with methods that operate on D1:

- `create(db, { id, userId, repoId, status })` — Insert row when session is created
- `updateTitle(db, sessionId, title)` — Set title (called after first user message)
- `updateStatus(db, sessionId, status)` — Update status + `updated_at`
- `updateLastMessageAt(db, sessionId)` — Touch `last_message_at` + `updated_at`
- `listByUser(db, userId, { repoId?, limit, cursor? })` — Paginated list, ordered by `updated_at DESC`
- `getById(db, sessionId)` — Single session lookup
- `deleteByUser(db, userId, sessionId)` — Delete row (or soft-delete by status)

### 3. Shared Types
**File:** `packages/shared/src/types/session.ts`

Add new types:

```typescript
// Response for GET /sessions (list)
export const SessionSummarySchema = z.object({
  id: z.string().uuid(),
  repoId: z.string(),
  title: z.string().nullable(),
  status: SessionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().nullable(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const ListSessionsResponseSchema = z.object({
  sessions: z.array(SessionSummarySchema),
  cursor: z.string().nullable(),     // for pagination
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;
```

### 4. API Routes — Session Listing
**File:** `services/api-server/src/routes/sessions.routes.ts`

Add a new `GET /sessions` endpoint (before the `/:sessionId` routes):

- **Auth:** Protected by `authMiddleware`
- **Query params:** `repoId?` (filter by repo), `limit?` (default 20, max 50), `cursor?` (pagination)
- **Response:** `ListSessionsResponse` — ordered by `updated_at DESC`
- Returns sessions for the authenticated user only

### 5. Session Creation — Write to D1
**File:** `services/api-server/src/routes/sessions.routes.ts`

In the existing `POST /sessions` handler, after DO init succeeds, also insert into D1:

```typescript
await SessionHistoryService.create(c.env.DB, {
  id: sessionId,
  userId: user.id,
  repoId: body.repoId,
  status: "provisioning",
});
```

### 6. Title Generation from First Message
**File:** `services/api-server/src/durable-objects/session-agent-do.ts`

In `handleChatMessage`, after storing the user message, check if this is the first user message for the session. If so, derive a title:

- Take the first ~80 characters of the user's message content
- Truncate at a word boundary, append "..." if truncated
- Call a new internal DO HTTP method or directly use the D1 binding (DOs can access D1) to update the title

Since DOs don't have direct D1 access in this architecture, we have two options:
- **Option A (Recommended):** Pass `DB` (D1 binding) into the DO during init, store it, and use it for D1 writes
- **Option B:** Have the DO call back to the API server to update D1 — adds complexity

For Option A: The DO already receives `Env` (which includes `DB`). We can use `this.env.DB` directly from within the DO to write to D1.

Implementation in `handleChatMessage`:
```typescript
// After saving user message to DO SQLite
const messageCount = /* count messages with role="user" */;
if (messageCount === 1) {
  const title = content.length > 80
    ? content.substring(0, 77).replace(/\s+\S*$/, '') + '...'
    : content;
  await SessionHistoryService.updateTitle(this.env.DB, sessionId, title);
}
```

### 7. Status Sync to D1
**File:** `services/api-server/src/durable-objects/session-agent-do.ts`

The DO already has a `broadcastStatus()` method that fires on status transitions. Add a D1 update alongside:

```typescript
private async broadcastStatus(status: SessionStatus) {
  // existing broadcast logic...

  // Sync to D1
  if (this.state.sessionId) {
    await SessionHistoryService.updateStatus(this.env.DB, this.state.sessionId, status);
  }
}
```

Also update `last_message_at` in D1 when new messages arrive (in `handleChatMessage` and on agent finish).

### 8. Session Deletion — Update D1
**File:** `services/api-server/src/routes/sessions.routes.ts`

In the `DELETE /sessions/:sessionId` handler, after the DO deletion, update D1:

```typescript
await SessionHistoryService.updateStatus(c.env.DB, sessionId, "terminated");
```

This keeps the record visible in history (with "terminated" status) rather than deleting it from D1. Users can still see what they worked on.

### 9. Build and Typecheck
- Run `pnpm build` and `pnpm typecheck` across all packages
- Run `pnpm lint` to catch any issues

## Summary of Files to Change/Create

| File | Action |
|------|--------|
| `services/api-server/migrations/0003_sessions.sql` | **Create** — D1 migration |
| `services/api-server/src/lib/session-history.ts` | **Create** — D1 session CRUD service |
| `packages/shared/src/types/session.ts` | **Edit** — Add `SessionSummary`, `ListSessionsResponse` types |
| `packages/shared/src/types/index.ts` | **Edit** — Export new types (if not already re-exported) |
| `services/api-server/src/routes/sessions.routes.ts` | **Edit** — Add `GET /sessions`, update `POST` and `DELETE` |
| `services/api-server/src/durable-objects/session-agent-do.ts` | **Edit** — Title generation, status sync, last_message_at sync to D1 |

## Out of Scope (for now)
- Session search/filtering by title
- Session renaming by user
- Deleting session history entries from the list (soft delete is sufficient)
- Resuming sessions that have been terminated (would need sprite re-provisioning)
