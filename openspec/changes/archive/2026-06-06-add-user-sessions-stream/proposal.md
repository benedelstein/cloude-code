## Why

The sidebar session list can show stale working state because it only receives live state for the currently viewed session. Users need one app-level live stream for session summaries so off-screen sessions return from responding to idle, show branch or pull request state, and stay consistent without polling every row.

## What Changes

- Add a user-scoped `UserSessionsDO` that owns live WebSocket fanout for a user's session summary changes.
- Add a short-lived user sessions WebSocket token endpoint and a direct WebSocket route for the web client.
- Publish session-summary invalidations after D1 summary mutations complete, letting `UserSessionsDO` fetch the fresh `SessionSummary` from D1 and broadcast it.
- Update the web `SessionListProvider` to connect once to the user sessions stream, patch loaded rows from full-summary events, and refresh from D1 on reconnect or resync requests.
- Change sidebar list ordering to use stable creation time rather than mutation time, so working-state changes do not reorder the sidebar.
- Keep D1 as the durable source of truth; the new DO is a live delivery and coalescing layer only.

## Capabilities

### New Capabilities

- `user-sessions-stream`: User-scoped live delivery of session summary updates for app sidebar and other session-list consumers.

### Modified Capabilities

- None.

## Impact

- API server: new Durable Object binding/class, WebSocket route, token mint/verify service, publisher service, session-list query sorting updates, and summary mutation hooks.
- Shared package: new user sessions WebSocket message schemas and token response type.
- Web app: new token/connection hook and `SessionListProvider` integration.
- D1: new created-at sidebar ordering indexes and cursor/query updates.
- Tests: repository sorting, token verification, publisher ordering, user-scoped summary fetch, and client provider stream handling.
