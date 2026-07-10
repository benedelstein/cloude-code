## Context

The session provider is selected at creation, defaulted by the API contract when omitted, and persisted in the session Durable Object's `ClientState.agentSettings`. The current chat API only permits model and effort changes within that provider, so provider is an immutable session property.

D1 is already the denormalized read model for session summaries. Fields such as `working_state`, pushed branch, pull request state, and last assistant message metadata are copied from session activity into the existing `sessions` row, then `SessionSummaryService` invalidates `UserSessionsDO` so clients receive the current D1 summary.

iOS loads a cached `SessionSummaryModel` and cached messages before connecting the session WebSocket. Because the summary does not contain provider today, cached assistant messages are initially normalized with an unknown provider and adjacent generic actions become a misleading "Used N tools" group. Live state later supplies the provider and forces a second projection.

This change crosses the D1 schema, server read model, shared API contract/code generation, iOS persistence, and transcript bootstrap path. The D1 rollout must support existing database rows, while the unshipped iOS cache does not require a versioned migration.

## Goals / Non-Goals

**Goals:**

- Make the immutable session provider available in the D1-backed session summary and iOS cache.
- Build cached assistant transcript display data with an authoritative provider on the first render.
- Keep the server rollout additive and keep the iOS cache schema simple while the product is unshipped.
- Remove tool-signature provider inference.

**Non-Goals:**

- Persist all `SessionClientState` fields in D1 or SwiftData.
- Add provider switching to an existing session.
- Put provider on individual message records.
- Backfill or reconcile legacy D1 provider values from Durable Object state.
- Change provider-specific normalization or grouping rules once a provider is known.

## Decisions

### Add a nullable provider column to the existing D1 session row

Migration `0026` will add `provider_id TEXT NULL` to `sessions`; this is a new column, not a new row or table. `SessionsRepository.create` will require the selected provider and write it with the other session summary fields. `SessionsService` will resolve `request.settings?.provider ?? DEFAULT_AGENT_SETTINGS.provider` once and pass the same value to both the D1 create and Durable Object initialization paths.

The column remains nullable because existing rows cannot be truthfully backfilled from D1 alone. A SQL default would silently label legacy OpenAI Codex sessions as the current default provider, which is worse than a temporary unknown value.

Alternatives considered:

- **Provider on every message:** rejected because provider is session-level immutable metadata and per-message duplication invites inconsistency.
- **A separate provider/cache table:** rejected because the existing session row is already the session summary read model.
- **A non-null column with the current default:** rejected because it fabricates data for legacy sessions.

### Expose provider as rollout-compatible summary metadata

`SessionSummary` will expose `provider` as `ProviderId` when known and null or absent when unavailable. The wire field will tolerate both null and absence so a new iOS client can decode responses from an older server during rollout. New server responses always include the mapped D1 value.

The generated Swift CoreAPI model will be regenerated from the Zod contract. The API layer will map the optional wire provider to `Domain.AgentProviderID?`, preserving the existing `.unknown(String)` behavior for forward-compatible enum values.

The user-sessions stream needs no new event type: its existing full-summary created/updated payloads acquire the additive field. Existing session rows continue returning null; no provider-specific invalidation path is added.

### Extend the existing iOS session summary cache

Provider will be added to `Domain.SessionSummary`, `SessionSummaryEntity`, and `SessionSummaryModel`. SwiftData will persist the raw provider string as an optional field, mapping it through `AgentProviderID`, so legacy cached rows naturally read as nil.

Because the product has not shipped, implementation will keep the optional field in the current SwiftData schema and will not introduce `SchemaV2`, a migration stage, or an old-schema migration fixture. Normal entity persistence tests will verify nil and known provider round trips. Existing developer installations may reset or reinstall the app if a stale local development store cannot open after the schema changes.

Alternatives considered:

- **A separate client-state cache:** rejected because `SessionSummaryStore` already owns this session metadata and parallel caches would create two merge authorities.
- **Persist raw `SessionClientState`:** rejected because active turns, pending work, editor readiness, errors, and connection state are transient.

### Gate cached transcript projection on a known provider

`AgentSessionViewModel` will track an optional resolved transcript provider initialized from `session.provider`. Cached messages may be loaded from disk immediately, but assistant display data will not be projected until that value is known. If provider is already cached, the transcript builds once before the session socket connects. If a legacy summary has no provider, the cached transcript remains staged behind the existing loading state until authoritative live state arrives, then builds once.

Live state always wins for the active transcript. When its provider differs from the cached summary, the view model updates its resolved provider and rebuilds existing assistant display data without writing it back to D1. A same-provider live state does not rebuild the transcript.

`ToolActionNormalizer` retains its generic fallback when it is explicitly called with an unknown provider, but it will not inspect tool names or payload shapes to infer Claude Code or OpenAI Codex. The normal AgentSession bootstrap path will avoid calling it for cached assistant messages until provider is resolved.

Alternatives considered:

- **Infer from tool signatures:** rejected because tools can overlap, change names, or be introduced by MCP servers, making the result non-authoritative.
- **Render generically and rebuild later:** rejected because that is the visible flash being fixed.
- **Assume the current default provider:** rejected for the same legacy-session correctness reason as the D1 migration default.

## Risks / Trade-offs

- **Legacy sessions never gain a D1 provider** → Return null/absent and stage cached transcript projection until live state on each open; the affected population is intentionally accepted.
- **D1 and Durable Object state disagree** → Durable Object wins for the active transcript, but D1 is not repaired; new-session creation writes the same resolved provider to both stores to prevent this normally.
- **An existing developer build has a stale SwiftData store** → Reset or reinstall that development build; do not add production migration machinery before the product ships.
- **Staging a legacy cached transcript delays content until socket live state** → Prefer a short loading state over displaying semantically incorrect tool groups; this remains the accepted behavior for legacy sessions.
- **Server and client deploy at different times** → Make the API field additive and decodable when absent or null; deploy server migration/contract before relying on populated provider values.

## Migration Plan

1. Deploy the D1 migration adding nullable `provider_id`.
2. Deploy the server contract and repository changes. New session creation writes provider; session summary responses expose known/null provider.
3. Regenerate and ship clients. iOS adds the optional field to the current cache schema without a versioned migration and gates cached assistant projection until provider is known.
4. Remove the heuristic normalizer changes from the current PR and replace their tests with authoritative-provider bootstrap tests.

Rollback is additive: older servers and clients ignore the column/field. If iOS gating must be rolled back, `provider_id` can remain unused without changing existing session behavior. The migration must not be reversed while deployed code reads or writes the column.

## Open Questions

None. Provider is already immutable for a session; future provider switching would require atomically updating Durable Object settings and the D1 read model as a separate change.
