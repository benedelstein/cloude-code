## 1. Contract and persistence

- [ ] 1.1 Add migration 0028 with nullable `completion_code_hash` and extend the attempt state machine with `completion_ready`.
- [ ] 1.2 Require `completionCode` in the shared completion request, remove `SIGN_IN_NOT_READY` route plumbing, and regenerate/test Swift CoreAPI.
- [ ] 1.3 Implement atomic one-time completion-code issuance and dual-secret, client-bound, unexpired at-most-once claim.

## 2. Server callback choreography

- [ ] 2.1 Issue completion codes at web and direct-native final OAuth handoffs, including installation-preparation fallback.
- [ ] 2.2 Split web sign-in, native sign-in, and authenticated-management installation state purposes; finalize native attempts only from the validated setup callback.
- [ ] 2.3 Add service and route regressions for transferred links, mixed/wrong/missing secrets, exact-pair success, replay, concurrency, expiry, failure, wrong client, and pending installation.

## 3. Web BFF

- [ ] 3.1 Require matching callback `attemptId` and `completionCode` plus the encrypted claim cookie before API completion; never persist the callback code.
- [ ] 3.2 Preserve account switching, valid-session revisit, concurrent-tab cookie preservation, and session-cookie-before-install ordering tests.

## 4. iOS

- [ ] 4.1 Update the API protocol/mapping for completion code and remove readiness-error helpers.
- [ ] 4.2 Validate callback attempt/code before completion, treat all browser cancellation silently with zero completion calls, and preserve one web-auth session.
- [ ] 4.3 Update API and SessionStore tests for exact callback proof, missing/mismatched/error callbacks, cancellation, and one-session installation paths.

## 5. Documentation and verification

- [ ] 5.1 Update iOS auth and affected inline docs for two-secret binding, no-callback/no-session, cancellation tradeoff, fixed TTLs, and secret handling.
- [ ] 5.2 Run focused contract, server, web, and iOS tests; SwiftLint fix/strict; generic simulator build; and repo build/lint/typecheck/test as feasible.
- [ ] 5.3 Audit the final diff for generated-code ownership, secret leakage, one-session preservation, and accidental changes over the pre-existing dirty worktree.
