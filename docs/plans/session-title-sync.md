# Make Creation the Single Source of Truth for Initial Titles

## Summary

- Do not make DO init block on title generation.
- Do not add duplicate client-only title state.
- Do not add a custom websocket title message for this case.
- Make `sessions.service.createSession()` the only place that auto-generates the initial title, since creation already returns `title` and the web app already seeds local session list state from that response.

## Key Changes

- Remove first-message title generation from [session-agent-history.ts](/Users/ben/code/cloude-code/services/api-server/src/durable-objects/session-agent-history.ts).
- Keep `updateSessionHistoryData()` responsible only for durable history metadata like `lastMessageAt`; it should not mutate `sessions.title`.
- Keep initial title generation in [sessions.service.ts](/Users/ben/code/cloude-code/services/api-server/src/lib/sessions/sessions.service.ts) after session creation and before returning the `CreateSessionResponse`.
- Preserve current web behavior in [session-creation-form.tsx](/Users/ben/code/cloude-code/apps/web/app/(app)/session-creation-form.tsx): use the returned `session.title` to seed `SessionListProvider` immediately.
- Treat the D1 `sessions.title` row as the server source of truth; the existing local `updateTitle(...)` path remains only for optimistic manual rename UX.

## Public Interfaces

- No websocket schema changes.
- No `ClientState` changes.
- No new REST endpoints.
- `CreateSessionResponse.title` remains the authoritative initial-title payload.

## Test Plan

- Create session with `initialMessage`: returned `title` is non-null and persisted to the `sessions` row.
- Initial pending message later flows through the DO: title is not regenerated or overwritten.
- Session created from the web form: header/sidebar/document title shows the creation-time title without requiring refresh.
- Manual rename still works: optimistic UI updates immediately and persists after `PATCH /sessions/:id/title`.

## Assumptions

- Chosen default: sessions that need an auto-title are created with an initial message.
- If you later want server-driven title changes after websocket connect for other cases, prefer adding `title` to `ClientState` and syncing it through Agents state updates, not a bespoke websocket event.
