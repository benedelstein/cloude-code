## 1. Shared Protocol And Token Types

- [x] 1.1 Add shared `UserSessionsWebSocketTokenResponse` schema/type for the token mint endpoint.
- [x] 1.2 Add shared `UserSessionsServerMessage` Zod schemas for `user_sessions.connected`, `session.summary.updated`, `session.summary.removed`, and `session.list.resync_required`.
- [x] 1.3 Export the new shared types from the shared package index.

## 2. API Server Token And Route Plumbing

- [x] 2.1 Add a user sessions WebSocket token service with distinct token type `user-sessions-websocket`, TTL, mint, and verify functions.
- [x] 2.2 Add `POST /sessions/updates/token` to the sessions OpenAPI schema and routes, authenticated through existing session auth.
- [x] 2.3 Add `GET /sessions/updates?token=...` route that verifies the user sessions token, strips the query token, and forwards the WebSocket upgrade to `USER_SESSIONS.getByName(userId)`.
- [x] 2.4 Add `USER_SESSIONS` to `Env`, wrangler Durable Object bindings, wrangler migrations, and runtime exports.

## 3. UserSessionsDO

- [x] 3.1 Create `UserSessionsDO` runtime class with hibernating WebSocket accept/connect handling.
- [x] 3.2 Send `user_sessions.connected` after a valid client connects.
- [x] 3.3 Add internal publish handling for `session.summary.invalidate`, `session.summary.remove`, and optional `session.list.resync_required`.
- [x] 3.4 On invalidation, fetch the current summary by `sessionId` and `userId` from D1 and broadcast a full `session.summary.updated` message when visible.
- [x] 3.5 Broadcast `session.summary.removed` when the summary row is missing or archived.
- [x] 3.6 Validate every outbound browser message with the shared schema before sending.

## 4. D1 Session Summary And Stable Ordering

- [x] 4.1 Add D1 migration indexes for created-time sidebar ordering.
- [x] 4.2 Replace session-list repo cursors from `maxUpdatedAt` to `maxCreatedAt`.
- [x] 4.3 Update grouped session list queries to order repo groups by newest session `created_at` and rows by `created_at DESC, id DESC`.
- [x] 4.4 Update per-repo session pagination to use `created_at` cursors.
- [x] 4.5 Add repository method to fetch a summary by both `sessionId` and `userId`.
- [x] 4.6 Keep working-state, pushed-branch, and pull-request summary writes from changing sidebar ordering fields.

## 5. Summary Invalidation Publishing

- [x] 5.1 Add a `UserSessionsPublisher` service that sends invalidations to `USER_SESSIONS.getByName(userId)`.
- [x] 5.2 Update `SessionSummaryService` dependencies to include `getUserId` and an ordered background work queue.
- [x] 5.3 Publish `session.summary.invalidate` only after successful D1 writes for working state, pushed branch, pull request creation, and pull request state updates.
- [x] 5.4 Publish remove or resync events after archive and delete session mutations.
- [x] 5.5 Publish invalidate or resync events after title changes and session creation when other open tabs need to see the change.
- [x] 5.6 Wire publisher dependencies from `SessionAgentDO`, session routes/services, and webhook-driven PR update paths.

## 6. Web Client Integration

- [x] 6.1 Add client API function to request the user sessions WebSocket token.
- [x] 6.2 Add `use-user-sessions-websocket-token` hook with caching, retry, terminal-auth handling, and token refresh behavior matching the session WebSocket token hook.
- [x] 6.3 Add `use-user-sessions-websocket` hook that opens one direct WebSocket to `/sessions/updates`.
- [x] 6.4 Update `SessionListProvider` to start the user sessions WebSocket after initial `listSessions()` load.
- [x] 6.5 Replace loaded rows on `session.summary.updated` and remove loaded rows on `session.summary.removed`.
- [x] 6.6 Call `refresh()` on `session.list.resync_required`, WebSocket reconnect, and tab visibility return.
- [x] 6.7 Keep the existing active-session bridge working for optimistic same-session updates while the user sessions stream provides off-session updates.

## 7. Tests

- [x] 7.1 Add unit tests for user sessions token minting and verification, including wrong-type and expired tokens.
- [x] 7.2 Add route tests for token endpoint auth and user sessions WebSocket route rejection behavior.
- [x] 7.3 Add `UserSessionsDO` tests for connected, update, remove, user scoping, and validation behavior.
- [x] 7.4 Update sessions repository tests for created-time grouping, row ordering, and pagination cursors.
- [x] 7.5 Add publisher or `SessionSummaryService` tests proving D1 write happens before invalidation publish.
- [x] 7.6 Add web provider tests for update, remove, resync, reconnect refresh, and unloaded-row handling.

## 8. Validation

- [x] 8.1 Run `pnpm build`.
- [x] 8.2 Run `pnpm lint`.
- [x] 8.3 Run `pnpm typecheck`.
- [x] 8.4 Run `pnpm test`.
- [ ] 8.5 Manually verify with two sessions that an off-screen responding row returns to idle and then shows branch or pull request icon without changing sidebar order.
