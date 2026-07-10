## 1. Persist Provider in the D1 Session Summary

- [x] 1.1 Add migration `0026` with nullable `sessions.provider_id`; do not assign a default to existing rows.
- [x] 1.2 Resolve the explicit-or-default provider once in session creation, require it in `CreateSessionParams`, and write it in the initial D1 insert before Durable Object initialization.
- [x] 1.3 Add `provider` to D1 row-to-summary mapping and repository create/list/get tests, including a legacy null row and a new explicit/default provider row.

## 2. Extend the Shared Summary Contract

- [x] 2.1 Add rollout-compatible optional/nullable `provider: ProviderId` metadata to the Zod `SessionSummary` contract and update server session/user-session stream tests.
- [x] 2.2 Regenerate TypeScript/Swift contract outputs with the repository codegen command and verify generated files are not hand-edited.
- [x] 2.3 Update API mapping tests to cover known, absent, and forward-unknown provider values.

## 3. Cache Provider in the iOS Session Summary

- [x] 3.1 Add optional `AgentProviderID` provider metadata to `Domain.SessionSummary` and `SessionSummaryModel`, preserving unknown raw values.
- [x] 3.2 Add an optional raw provider field to `SessionSummaryEntity` and update entity/model snapshot mappings and cache tests.
- [x] 3.3 Keep the optional field in the current SwiftData schema with no versioned migration, and test nil, known, and unknown provider persistence round trips; reset stale development stores if needed.

## 4. Make Cached Transcript Bootstrap Deterministic

- [x] 4.1 Track an optional resolved transcript provider in `AgentSessionViewModel`, initializing it from the cached `SessionSummaryModel`.
- [x] 4.2 Build cached messages immediately when provider is known; otherwise stage them behind the loading state until session live state supplies the provider.
- [x] 4.3 Treat a differing live-state provider as authoritative for the active transcript and rebuild existing assistant display data without writing it back to D1, while avoiding a rebuild when it matches the cached provider.
- [x] 4.4 Remove the tool-signature provider inference from the current PR while retaining the explicit unknown-provider generic fallback.
- [x] 4.5 Add view-model-level tests for cached known-provider first render, legacy nil-provider staging/unblocking, matching-provider stability, and mismatch correction; retain focused normalizer fallback tests.

## 5. Validate and Publish

- [x] 5.1 Run focused API server repository, contract, and user-sessions stream tests.
- [x] 5.2 Run iOS package/cache/API tests and focused AgentSession transcript state/normalization tests on a supported simulator.
- [x] 5.3 Run repository `pnpm build`, `pnpm lint`, and `pnpm typecheck`, plus strict SwiftLint and the generic iOS Simulator build required by `AGENTS.md`.
- [x] 5.4 Audit the final diff for generated-file and migration correctness, update the draft PR description, commit, and push the replacement implementation.
- [ ] 5.5 Ask a subagent to review the updated PR, address actionable findings, and rerun affected validation before marking the PR ready.
