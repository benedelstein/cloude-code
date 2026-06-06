## Context

The existing sidebar reads session summaries from D1 through `listSessions()` and then holds that list in `SessionListProvider`. While viewing a session, `SessionProvider` copies the active session WebSocket state into the sidebar cache. Off-session rows do not receive those per-session WebSocket updates, so a row can remain stuck in `responding` or miss branch and pull request state until the list is refreshed.

The session runtime is already scoped correctly: `SessionAgentDO` owns one session's messages, VM lifecycle, active turn, and per-session WebSocket. The new need is not another session runtime channel. It is a user-level live projection of the D1 `sessions` summary rows that backs the sidebar.

## Goals / Non-Goals

**Goals:**

- Add one live user sessions stream per open app tab so session summary rows update even when the user is viewing another session.
- Keep D1 as the durable source of truth for session summaries.
- Keep `SessionAgentDO` as the authority for one session runtime and avoid connecting the sidebar to every session DO.
- Let `UserSessionsDO` fetch the full current summary row after invalidation, then broadcast that full `SessionSummary` to clients.
- Sort sidebar groups and rows by stable creation time, not by update time.
- Recover missed live events through normal `listSessions()` refreshes.

**Non-Goals:**

- Do not route chat messages, agent chunks, setup logs, todo lists, or tool events through `UserSessionsDO`.
- Do not make `UserSessionsDO` a source of truth for sessions.
- Do not add a per-session WebSocket connection for each visible sidebar row.
- Do not add a general event bus or pub/sub abstraction beyond user session summaries.

## Decisions

### Use `UserSessionsDO` as the user-scoped fanout owner

Add a new Durable Object named `UserSessionsDO`, bound as `USER_SESSIONS`, keyed by authenticated `userId`.

Rationale:

- The coordination scope is different from `SessionAgentDO`: one session versus one user's live session summary stream.
- One user DO can fan out to all open app tabs for that user.
- Cloudflare Durable Object WebSocket hibernation fits long-lived idle sidebar sockets without keeping the DO hot.

Alternatives considered:

- Connect the sidebar to every session DO: rejected because it creates one socket per row and couples summary UI to chat protocol.
- Poll `listSessions()`: rejected as laggy and wasteful.
- Read all live state from session DOs during list rendering: rejected because it couples the list endpoint to many DO instances and makes D1 less authoritative.

### Publish invalidations internally, full summaries externally

Session mutation paths publish an internal invalidation after the D1 write resolves:

```ts
{ type: "session.summary.invalidate", sessionId: string }
```

`UserSessionsDO` then fetches the fresh summary row scoped by both `userId` and `sessionId`:

```sql
SELECT * FROM sessions WHERE id = ? AND user_id = ?
```

If the row exists and is not archived, the DO broadcasts:

```ts
{ type: "session.summary.updated", session: SessionSummary }
```

If the row is missing or archived, it broadcasts:

```ts
{ type: "session.summary.removed", sessionId: string }
```

Rationale:

- Session mutation paths do not need to know how to construct sidebar rows.
- The stream DO owns coalescing, user scoping, and fanout.
- Browser clients receive one simple full-row protocol and avoid partial patch merge bugs.

### D1 write completes before invalidation

The D1 mutation must complete before publishing the invalidation. Otherwise `UserSessionsDO` can fetch the old row.

For `SessionAgentDO`, keep turn lifecycle paths fast by queueing ordered background summary work rather than blocking agent execution on browser fanout:

```text
enqueue:
  write D1 summary field
  notify UserSessionsDO with sessionId
```

The queue must preserve ordering for a single session so a delayed `responding` write cannot publish after a later `idle` write. The publisher can log failures and rely on refresh recovery.

### Add a short-lived user sessions WebSocket token

The web app's REST API calls go through the Next.js proxy with cookie-backed bearer auth, but direct WebSocket connections use the API host. Add:

```http
POST /sessions/updates/token
```

Response:

```ts
{
  token: string;
  expiresAt: string;
}
```

The token payload uses a distinct type:

```ts
{
  type: "user-sessions-websocket";
  userId: string;
  exp: number;
}
```

The browser connects directly to:

```text
/sessions/updates?token=<token>
```

The route verifies the query token, derives the user id, removes the token from the forwarded request, and forwards the WebSocket upgrade to `USER_SESSIONS.getByName(userId)`. This route lives under the sessions domain because it is not an agent runtime channel.

### Keep external stream messages narrowly typed

Add shared Zod schemas for the browser protocol:

```ts
type UserSessionsServerMessage =
  | { type: "user_sessions.connected" }
  | { type: "session.summary.updated"; session: SessionSummary }
  | { type: "session.summary.removed"; sessionId: string }
  | { type: "session.list.resync_required" };
```

`session.list.resync_required` is rare fallback: when the system knows the user's session list may be stale but cannot or should not emit exact row updates. The client handles it by calling `listSessions()` again.

### Use stable creation-time ordering

Change `listSessions()` repository ordering and cursors from `updated_at` to `created_at`:

- repo groups: `MAX(created_at) DESC, repo_id DESC`
- sessions within a repo: `created_at DESC, id DESC`
- per-repo pagination cursor: `(created_at, id)`
- repo pagination cursor: `(max_created_at, repo_id)`

Working-state, branch, and PR state changes must not update ordering fields. Title/archive/delete can continue to update `updated_at` for audit purposes, but sidebar list placement is based on `created_at`.

### Client connection lifecycle

`SessionListProvider` remains the list owner:

1. Fetch initial list through `listSessions()`.
2. Fetch a user sessions WebSocket token.
3. Open one direct WebSocket to `/sessions/updates`.
4. On `session.summary.updated`, patch the loaded row if present.
5. On `session.summary.removed`, remove the loaded row if present.
6. On `session.list.resync_required`, reconnect recovery, or tab visibility return, refresh from `listSessions()`.
7. Refresh the WebSocket token if the connection closes after token expiry.
8. Use exponential backoff for transient token fetch or socket failures.

If an updated session is not currently loaded because it is outside pagination, the client does not insert it blindly. It either ignores the update or refreshes the list if the event could affect visible grouping. Created-time ordering keeps most summary updates from requiring list reshaping.

## Risks / Trade-offs

- [Risk] A publish fails after the D1 write succeeds -> [Mitigation] D1 remains authoritative; reconnect, focus refresh, or explicit resync repairs the client.
- [Risk] Internal invalidations arrive out of order for the same session -> [Mitigation] queue summary writes and invalidations per `SessionSummaryService` instance; optionally add a later `summary_version` column if observed.
- [Risk] `UserSessionsDO` accidentally publishes another user's row -> [Mitigation] every summary fetch filters by both `sessionId` and the DO's `userId`.
- [Risk] A full-summary update for an unloaded row is ambiguous under pagination -> [Mitigation] patch only loaded rows by default and use resync for structural list changes.
- [Risk] New DO binding requires deployment migration -> [Mitigation] add a wrangler DO migration tag and keep REST `listSessions()` behavior working before the client stream is enabled.

## Migration Plan

1. Add shared types and server token plumbing without changing client behavior.
2. Add `UserSessionsDO`, route, binding, and migration.
3. Add repository methods and created-time cursor/index migration.
4. Wire summary invalidation publishing after successful D1 writes.
5. Add client token and stream hooks; integrate them into `SessionListProvider`.
6. Run full validation and manually verify two-session behavior with one session active and another running off-screen.

Rollback is straightforward: disable the client stream connection and the app falls back to current `listSessions()` plus active-session bridge behavior. The new D1 indexes and DO binding can remain unused.

## Open Questions

- Should create-session events from another tab insert into the visible list immediately, or should they trigger `session.list.resync_required`? The safer first implementation is resync for structural list changes.
