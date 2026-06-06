# user-sessions-stream Specification

## Purpose
TBD - created by archiving change add-user-sessions-stream. Update Purpose after archive.
## Requirements
### Requirement: User sessions WebSocket authentication

The system SHALL provide an authenticated endpoint that mints a short-lived WebSocket token for a user's live sessions stream. The live WebSocket route MUST verify that token, derive the user id from it, and bind the connection to the `UserSessionsDO` instance for that user.

#### Scenario: Authenticated token mint

- **WHEN** an authenticated user requests a user sessions WebSocket token
- **THEN** the system returns a token and expiration timestamp scoped to that authenticated user's id

#### Scenario: WebSocket route rejects invalid token

- **WHEN** a client connects to the user sessions WebSocket route with a missing, invalid, expired, or wrong-type token
- **THEN** the system rejects the connection without attaching it to a `UserSessionsDO`

#### Scenario: WebSocket route connects to user-scoped DO

- **WHEN** a client connects to the user sessions WebSocket route with a valid token
- **THEN** the system forwards the WebSocket upgrade to the `UserSessionsDO` instance named by the token user id

### Requirement: UserSessionsDO fanout

The system SHALL use `UserSessionsDO` as the user-scoped live fanout owner for session summary changes. `UserSessionsDO` MUST NOT own durable session state and MUST only deliver validated user session stream messages to connected clients.

#### Scenario: Client receives connected event

- **WHEN** a valid client WebSocket connects to `UserSessionsDO`
- **THEN** the system sends a `user_sessions.connected` message on that connection

#### Scenario: Multiple tabs receive update

- **WHEN** a user's `UserSessionsDO` has multiple connected WebSocket clients and a session summary update is published
- **THEN** the system broadcasts the same validated update message to each connected client

### Requirement: Summary invalidation resolves from D1

The system SHALL publish internal session-summary invalidations to `UserSessionsDO` only after the corresponding D1 mutation has completed. On invalidation, `UserSessionsDO` MUST fetch the current `SessionSummary` from D1 using both the invalidated session id and the DO's user id before broadcasting to clients.

#### Scenario: Working state update publishes fresh summary

- **WHEN** a session working state D1 write completes and the session summary is invalidated
- **THEN** `UserSessionsDO` fetches the current summary row from D1 and broadcasts `session.summary.updated` with the full `SessionSummary`

#### Scenario: User scoping prevents cross-user publish

- **WHEN** `UserSessionsDO` receives an invalidation for a session id that does not belong to its user id
- **THEN** the system does not broadcast another user's session summary

#### Scenario: Archived or missing row removes visible session

- **WHEN** `UserSessionsDO` resolves an invalidated session id to no visible non-archived summary row
- **THEN** the system broadcasts `session.summary.removed` with that session id

### Requirement: Browser stream applies full summaries

The web client SHALL connect once to the user sessions stream from `SessionListProvider` and apply full-summary update messages to its loaded session list. The client MUST continue to use `listSessions()` as the recovery source of truth.

#### Scenario: Loaded row is patched

- **WHEN** the client receives `session.summary.updated` for a session currently loaded in the list
- **THEN** the client replaces that loaded row's summary with the received full `SessionSummary`

#### Scenario: Removed row is removed

- **WHEN** the client receives `session.summary.removed` for a session currently loaded in the list
- **THEN** the client removes that session from the loaded list

#### Scenario: Resync request refreshes from D1

- **WHEN** the client receives `session.list.resync_required`
- **THEN** the client refreshes the session list through `listSessions()`

#### Scenario: Reconnect recovers missed events

- **WHEN** the user sessions WebSocket reconnects after a close or transient failure
- **THEN** the client refreshes the session list through `listSessions()` to recover any missed updates

### Requirement: Stable creation-time sidebar ordering

The system SHALL order sidebar repo groups and session rows by stable creation time instead of update time. Session summary state changes such as working state, pushed branch, and pull request state MUST NOT reorder the sidebar.

#### Scenario: Working state does not reorder sessions

- **WHEN** an existing session changes working state from `responding` to `idle`
- **THEN** the sidebar updates the session status indicator without moving the session row because of that state change

#### Scenario: Session list uses created-time ordering

- **WHEN** the client loads the session list
- **THEN** repo groups are ordered by their newest session creation time and sessions within each repo are ordered by `createdAt` descending

#### Scenario: Created-time pagination remains stable

- **WHEN** the client loads additional repo groups or sessions within a repo
- **THEN** pagination uses creation-time cursors so summary mutations do not cause rows to shift between pages

