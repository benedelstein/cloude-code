## 1. Contracts and persistence

- [x] 1.1 Add explicit web/native GitHub sign-in start requests, the shared start response, the shared completion request, and concrete web/native completion responses in `packages/api-contract/src/auth.ts`; add stable `SIGN_IN_NOT_READY` and `INVALID_SIGN_IN_ATTEMPT` error handling at the HTTP boundary.
- [x] 1.2 Remove `continueToInstallation`, `continuationToken`, `NativeLoginContinuationRequest`, and superseded direct sign-in token schemas from the client contract while preserving native refresh/logout and GitHub reauthorization contracts.
- [x] 1.3 Regenerate Swift CoreAPI auth types and update contract/codegen tests so web and iOS each compile against one concrete completion response.
- [x] 1.4 Add the next D1 migration for `sign_in_attempts`, supporting indexes, and a nullable sign-in-attempt reference on the existing `oauth_states` table.
- [x] 1.5 Implement `SignInAttemptRepository` with create, identity-ready transition, constant-time claim-token verification before status disclosure, client-bound claim, expiry checks, at-most-once consumption, concurrent-claim protection, and expired-row pruning.
- [x] 1.6 Generalize the existing OAuth-state repository/service into purpose-aware temporary external-auth callback state storage while preserving the physical table; support one-time installation-state creation/consumption, optional sign-in-attempt association, stored return targets, expiry checks, and expired-row pruning.
- [x] 1.7 Associate login OAuth-state and installation callback-state rows with sign-in attempts where needed without changing reauthorization/provider OAuth behavior.

## 2. Shared GitHub sign-in services

- [x] 2.1 Extract shared GitHub identity exchange so the API callback consumes OAuth state, exchanges the code once, upserts the user, and persists encrypted GitHub credentials before any web/native session is issued.
- [x] 2.2 Implement `GitHubSignInFlowService.startWeb` with a fixed 10-minute attempt TTL and `.startNative` with a fixed 30-minute attempt TTL; both use route-bound client type, exact redirect validation, hashed claim tokens, and fresh 10-minute OAuth state without deadline extension on transitions.
- [x] 2.3 Implement OAuth callback transitions from `awaiting_oauth` to `identity_ready` or `failed`, including client-bound denial redirects and structured logging that excludes codes, claim tokens, and session credentials.
- [x] 2.4 Generalize `NativeGitHubInstallationService` into a platform-neutral `GitHubInstallationService` backed by the existing purpose-aware temporary state store and a fixed 30-minute callback-state TTL for both chained sign-in and authenticated repository management.
- [x] 2.5 After OAuth, continue automatically to GitHub App installation when no installation exists; otherwise continue directly toward the bound client, without an installation-policy request field.
- [x] 2.6 Implement installation callback consumption so it redirects only to stored targets, clears repository-listing synchronization metadata, and ignores browser-provided installation/repository identifiers as access evidence.
- [x] 2.7 Implement concrete `completeWeb` issuance for an identity-ready web attempt, returning only opaque web session data plus the server-selected next redirect.
- [x] 2.8 Implement concrete `completeNative` issuance for an identity-ready native attempt, returning only the native access/refresh token pair and user.
- [x] 2.9 Add service/repository tests for OAuth replay, installation-state replay, exact 10/30-minute TTL boundaries, no transition-based extension, token verification before status disclosure, wrong-client completion, `SIGN_IN_NOT_READY`, duplicate completion, concurrent completion, existing/missing installation, cancellation-ready identity, and untrusted setup parameters.

## 3. API routes and hard cutover

- [x] 3.1 Add parsed OpenAPI routes for `POST /auth/github/web/start`, `/web/complete`, `/native/start`, and `/native/complete`, mapping typed service errors to stable response codes and statuses.
- [x] 3.2 Update `/auth/callback` to consume the attempt-linked OAuth state, complete identity exchange server-side, and redirect web attempts to their BFF completion URL or native attempts to installation/custom-scheme navigation; OAuth denial uses the bound client callback with attempt ID and `error=OAUTH_DENIED`.
- [x] 3.3 Update GitHub installation callback routing to support stored web and native return targets through the platform-neutral installation service.
- [x] 3.4 Preserve authenticated `/auth/github/install/start`, native refresh/logout, and GitHub reauthorization while associating repository-management callback state with the generalized temporary state store.
- [x] 3.5 Remove `GET /auth/github`, `POST /auth/token`, `POST /auth/native/token`, the old native continuation semantics, native-login OAuth purposes, and all compatibility branches/tests/docs that reference them.
- [x] 3.6 Add route tests pinning concrete web/native response shapes, exact redirect validation, attempt/client binding, callback redirects, stable errors, and absence of removed endpoints.

## 4. Web same-tab authentication adapter

- [x] 4.1 Add a same-origin BFF GitHub start route that validates relative `returnTo`, calls the API web-start route, stores attempt ID/claim token in an HttpOnly `SameSite=Lax` cookie with `Max-Age=600` seconds, and redirects to GitHub.
- [x] 4.2 Add a BFF completion route with explicit precedence: process a query-matching claim cookie first (handling `error=OAUTH_DENIED` or claiming and replacing any existing session), otherwise redirect a valid existing session to the default signed-in app route, otherwise show the retry surface; clear only matching temporary state.
- [x] 4.3 Ensure the BFF establishes the web session cookie before redirecting to GitHub installation so abandoning or delaying installation preserves authentication.
- [x] 4.4 Replace `useAuth` popup orchestration with ordinary same-tab navigation while preserving a validated application return path and retryable signed-out error state.
- [x] 4.5 Remove popup names, polling intervals, opener messaging, popup message schemas, popup-blocker errors, the old finalize route, and second-install-popup code.
- [x] 4.6 Update local callback bridging and preview-origin behavior so OAuth returns to the exact allowlisted BFF origin and installation returns to the stored final app route.
- [x] 4.7 Add web tests for start-cookie attributes, return-target rejection, preview callbacks, exact OAuth-denial URL handling, signed-in back-button revisits, concurrent-tab last-start-wins behavior and cookie preservation, attempt mismatch, cookie-before-install ordering, existing/missing installation redirects, abandoned installation, expiry cleanup, and no `window.open` dependency.
- [ ] 4.8 Validate the complete local web redirect journey with the local GitHub App and browser tooling for existing installation, missing installation, cancellation, and pending approval.

## 5. iOS native authentication adapter

- [x] 5.1 Replace `AuthorizePage`/continuation semantics in `UnauthenticatedAuthAPI` with a native sign-in attempt containing authorization URL, attempt ID, and claim token; remove direct OAuth-code exchange APIs.
- [x] 5.2 Implement the concrete native-complete request/response mapping inside `Modules/API`, returning `Domain.Session` and `Domain.User` without leaking CoreAPI wire types.
- [x] 5.3 Update `SessionStore.signIn` to hold attempt credentials only in memory, open one `ASWebAuthenticationSession`, verify the callback attempt ID, complete the native attempt, and adopt the returned session through `TokenCoordinator`; persist or log no attempt credential, and abandon it on process termination.
- [x] 5.4 On `.canceledLogin`, attempt native completion; retry briefly only for `SIGN_IN_NOT_READY`, adopt an identity-ready session, treat pre-OAuth cancellation as a silent signed-out outcome, and surface invalid/expired attempts as retryable sign-in failures.
- [x] 5.5 Remove iOS continuation-token storage, OAuth callback code parsing, generic exchange methods, and comments/tests that describe installation as an authentication state.
- [x] 5.6 Keep the normal signed-in UI when repository listing is empty or approval is pending; label the separate authenticated action **Manage repositories on GitHub** and refresh the active repository listing/search after returning.
- [x] 5.7 Update API and `SessionStore` tests for native start/complete mapping, memory-only attempt credentials and process-termination abandonment, matching/mismatched callback IDs, existing/missing installation in one web-auth session, cancellation before/after OAuth, bounded not-ready retry, pending approval, and empty repositories.
- [ ] 5.8 Validate the native flow against the local GitHub App in the simulator for existing installation, fresh installation, dismissal after OAuth, pending organization approval, and repository-list refresh after management.

## 6. Documentation and cleanup

- [x] 6.1 Update `docs/auth.md` with the sign-in-attempt state machine, explicit route contracts, web cookie timing, separate OAuth/installation state, and webhook/listing authority.
- [x] 6.2 Update `apps/ios/docs/auth.md` with the native attempt contract, one-system-session rationale, callback matching, cancellation recovery, and repository-independent signed-in state.
- [x] 6.3 Update affected API/web/iOS inline documentation and public Swift doc comments; remove the terms native continuation and configure access where the new concepts apply.
- [x] 6.4 Search the repository for every removed route, type, field, purpose, popup message, and native-continuation reference; delete stale generated fixtures and test helpers.

## 7. Verification

- [x] 7.1 Run API contract generation/tests and focused API-server auth, repository, route, webhook, and installation callback-state tests.
- [x] 7.2 Run focused web auth tests and validate the same-tab browser journey with local browser tooling.
- [x] 7.3 Run `swiftlint lint --fix`, `swiftlint lint --strict --no-cache`, targeted Swift auth/API tests, and the generic iOS Simulator build.
- [x] 7.4 Run repository-wide `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`, recording any unrelated baseline failures separately.
- [x] 7.5 Review the final diff to confirm the hard cutover has one shared server flow, explicit non-polymorphic web/native adapters, no popup path, no compatibility shim, and no changes to refresh/logout or GitHub reauthorization semantics.
