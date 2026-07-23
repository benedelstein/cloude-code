## Context

The iOS session screen already restores messages from `SessionMessageStore` before connecting its socket. `SessionSummaryStore` also persists the session title, provider, status, working state, pushed branch, and created pull request, but setup progress and complete model settings exist only in live `SessionClientState`. The view therefore shows an incomplete state until the socket hydrates.

The existing cache boundary is `SwiftData Entity <-> Domain Snapshot <-> EntityModel`, with shared stores wired through Needle and cleared on sign-out.

## Goals / Non-Goals

**Goals:**

- Restore the small amount of session presentation state that is missing from the summary cache.
- Load cached state before cached messages and replace it with full server state after connection.
- Keep writes simple and limited to meaningful snapshot changes and view disappearance.
- Follow the existing Domain, Entities, SwiftData, DI, and cache-reset patterns.

**Non-Goals:**

- Persisting raw `SessionClientState`.
- Replacing or duplicating the existing session summary cache.
- Caching pending messages, active-turn identifiers, editor URLs, provider connection state, todos, plans, or errors.
- Changing server state, WebSocket messages, or API contracts.

## Decisions

### D1. The new snapshot contains only state absent from the summary

Add a domain snapshot keyed by session ID with:

- agent settings as one value, including provider, model, effort, and token limit;
- setup-run state;
- a derived `isResponding` boolean;
- pull request states that the summary cannot represent, currently `creating` and `failed`.

Title, repo, status, working state, pushed branch, provider fallback, and created pull request remain sourced from `SessionSummaryModel`. This avoids two local owners for the same durable fields. The active-turn ID is reduced to a boolean because only the working presentation needs restoration.

### D2. Persistence follows the existing Entities pattern

Add a Codable Domain snapshot, SwiftData entity, observable entity model, and shared store in `Modules/Entities`. The entity may encode the small nested values as data, following the existing session-message cache pattern. Register the new entity in the current schema without adding a schema version because this is an independent additive model.

The store exposes per-session load, save, delete, and delete-all operations. SwiftData objects remain inside the cache actor.

### D3. Cache hydration precedes message hydration

For an existing session, `bind()` loads the cached session snapshot, then cached messages, then connects the socket. Restoring settings first ensures cached transcript messages use the best available provider. Draft sessions skip this cache.

The current summary model supplies immediately available summary-owned fields. The cached snapshot fills the remaining fields. A live client-state frame replaces the curated values, and a sync response replaces the responding value from its active-turn state.

### D4. Writes happen only for changed curated snapshots

The view model derives one cached snapshot from its current presentation state and compares it with the last loaded or saved snapshot. It saves only when that value changes after live-state, response-state, setup, model, or transitional pull-request mutations. It also saves the latest value before `unbind()` resets response state.

This avoids a timer or a separate synchronization state machine while preventing repeated writes for unrelated live-state fields.

### D5. User and session cleanup include the new cache

`CacheResetAction` clears all cached session-state rows on sign-out. Successful session deletion clears that session's state row. The cache remains intact if the server deletion fails.

## Risks / Trade-offs

- **[Cached responding state can be briefly stale]** -> Treat it as presentation-only and replace it as soon as live state or sync arrives.
- **[A newly added SwiftData model could expose store compatibility issues]** -> Add an on-disk reopen test using the previous model list and the new current schema.
- **[Corrupt encoded snapshot data cannot be restored]** -> Drop the unreadable row and continue with the summary and live server hydration.

## Migration Plan

1. Add and register the new cache model and store.
2. Wire the store into AgentSession, cache reset, and session deletion.
3. Add cache-first hydration and changed-snapshot writes to the view model.
4. Ship as an additive cache change; rollback can ignore the unused table.

## Open Questions

None.
